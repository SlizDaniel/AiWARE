// Domena ścieżek mapowania hali (PRD historia 12): telefon z IMU → PDR → metry.
// Walidacja wejścia jest czysta (parseMapPathInput), zapis loguje wpis w audycie
// w tej samej transakcji. data_version podbija route handler.
import type { PathMarker, PathPoint } from '@/lib/pdr'
import { logEvent, type Actor } from './db'
import { HttpError } from './http'
import { tsText, type Db } from './sql'

export type MapPathRecord = {
  id: number
  name: string
  points: PathPoint[]
  markers: PathMarker[]
  step_length: number
  actor: string
  created: string
}

export type MapPathInput = {
  name: string
  step_length: number
  points: PathPoint[]
  markers: PathMarker[]
}

const MAX_POINTS = 4000
const MAX_MARKERS = 200
const MAX_COORD_M = 1000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Punkt ścieżki: liczby skończone, współrzędne w rozsądnym metrażu hali. */
function parsePoint(raw: unknown, index: number): PathPoint {
  if (typeof raw !== 'object' || raw === null) {
    throw new HttpError(422, `Punkt ${index + 1} ścieżki jest nieprawidłowy.`)
  }
  const record = raw as Record<string, unknown>
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y) || !isFiniteNumber(record.t)) {
    throw new HttpError(422, `Punkt ${index + 1} ścieżki musi mieć liczby x, y i t.`)
  }
  if (Math.abs(record.x) > MAX_COORD_M || Math.abs(record.y) > MAX_COORD_M) {
    throw new HttpError(422, `Punkt ${index + 1} ścieżki jest dalej niż ${MAX_COORD_M} m od startu.`)
  }
  return { x: record.x, y: record.y, t: Math.max(0, record.t) }
}

/** Znacznik: etykieta 1–60 znaków, opcjonalna nazwa strefy. */
function parseMarker(raw: unknown, index: number): PathMarker {
  if (typeof raw !== 'object' || raw === null) {
    throw new HttpError(422, `Znacznik ${index + 1} jest nieprawidłowy.`)
  }
  const record = raw as Record<string, unknown>
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) {
    throw new HttpError(422, `Znacznik ${index + 1} musi mieć liczbowe współrzędne x i y.`)
  }
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  if (label.length === 0 || label.length > 60) {
    throw new HttpError(422, `Znacznik ${index + 1} potrzebuje etykiety (1–60 znaków).`)
  }
  const marker: PathMarker = { x: record.x, y: record.y, label }
  const zone = typeof record.zone === 'string' ? record.zone.trim().slice(0, 60) : ''
  if (zone) marker.zone = zone
  return marker
}

/** Waliduje ciało POST /api/map-paths; HttpError(422) z polskim komunikatem przy błędzie. */
export function parseMapPathInput(body: unknown): MapPathInput {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(422, 'Oczekiwano obiektu JSON ze ścieżką.')
  }
  const record = body as Record<string, unknown>

  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name.length === 0 || name.length > 80) {
    throw new HttpError(422, 'Nazwa ścieżki jest wymagana (1–80 znaków).')
  }

  const stepLength = record.step_length === undefined ? 0.7 : record.step_length
  if (!isFiniteNumber(stepLength) || stepLength < 0.3 || stepLength > 1.5) {
    throw new HttpError(422, 'Długość kroku musi być liczbą 0,3–1,5 m.')
  }

  if (!Array.isArray(record.points) || record.points.length < 2 || record.points.length > MAX_POINTS) {
    throw new HttpError(422, `Ścieżka musi mieć 2–${MAX_POINTS} punktów.`)
  }
  const points = record.points.map(parsePoint)

  if (record.markers !== undefined && !Array.isArray(record.markers)) {
    throw new HttpError(422, 'Znaczniki muszą być listą.')
  }
  const rawMarkers = record.markers ?? []
  if (rawMarkers.length > MAX_MARKERS) {
    throw new HttpError(422, `Ścieżka może mieć najwyżej ${MAX_MARKERS} znaczników.`)
  }
  const markers = rawMarkers.map(parseMarker)

  return { name, step_length: stepLength, points, markers }
}

/** Deserializacja JSONB z bazy (postgres.js i PGlite zwracają już sparsowane, ale defensywnie). */
function parseJsonArray<T>(value: unknown): T[] {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

const PATH_COLUMNS = `id, name, points, markers, step_length, actor, ${tsText('created')}`

function toRecord(row: Record<string, unknown>): MapPathRecord {
  return {
    id: row.id as number,
    name: row.name as string,
    points: parseJsonArray<PathPoint>(row.points),
    markers: parseJsonArray<PathMarker>(row.markers),
    step_length: row.step_length as number,
    actor: row.actor as string,
    created: row.created as string,
  }
}

function auditDetails(input: MapPathInput): string {
  const distance = input.points.reduce(
    (sum, point, index) =>
      index === 0 ? 0 : sum + Math.hypot(point.x - input.points[index - 1].x, point.y - input.points[index - 1].y),
    0,
  )
  return `${input.points.length} pkt · ${distance.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} m · ${input.markers.length} znaczników`
}

/** Zapisuje ścieżkę i dopisuje wpis w audycie (jedna transakcja). */
export async function saveMapPath(db: Db, input: MapPathInput, actor: Actor): Promise<MapPathRecord> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `INSERT INTO map_paths (name, points, markers, step_length, actor)
       VALUES ($1, $2::text::jsonb, $3::text::jsonb, $4, $5)
       RETURNING ${PATH_COLUMNS}`,
      [input.name, JSON.stringify(input.points), JSON.stringify(input.markers), input.step_length, actor.name],
    )
    await logEvent(tx, {
      eventType: 'map_path_saved',
      text: `Ścieżka „${input.name}” zapisana na mapie`,
      label: input.name,
      details: auditDetails(input),
      actor,
    })
    return toRecord(rows[0]!)
  })
}

export async function listMapPaths(db: Db): Promise<MapPathRecord[]> {
  const rows = await db.query<Record<string, unknown>>(`SELECT ${PATH_COLUMNS} FROM map_paths ORDER BY id DESC`)
  return rows.map(toRecord)
}

/** Usuwa ścieżkę; 404 gdy jej nie ma, wpis w audycie po skutecznym usunięciu. */
export async function deleteMapPath(db: Db, id: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `DELETE FROM map_paths WHERE id = $1 RETURNING ${PATH_COLUMNS}`,
      [id],
    )
    if (rows.length === 0) throw new HttpError(404, 'Nie znaleziono ścieżki do usunięcia.')
    const removed = toRecord(rows[0]!)
    await logEvent(tx, {
      eventType: 'map_path_deleted',
      text: `Ścieżka „${removed.name}” usunięta z mapy`,
      label: removed.name,
      details: auditDetails(removed),
      actor,
    })
  })
}
