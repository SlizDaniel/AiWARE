// Ścieżki mapowania hali: walidacja wejścia, zapis/lista/usunięcie (JSONB),
// wpisy w audycie. Baza w pamięci (PGlite), jak db.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ACTOR, initDb } from './db'
import { deleteMapPath, listMapPaths, parseMapPathInput, saveMapPath } from './mapPaths'
import { createPgliteDb, type Db } from './sql'
import type { PathMarker, PathPoint } from '@/lib/pdr'

const POINTS: PathPoint[] = [
  { x: 0, y: 0, t: 0 },
  { x: 0.7, y: 0, t: 900 },
  { x: 1.4, y: 0.7, t: 1800 },
]
const MARKERS: PathMarker[] = [{ x: 1.4, y: 0.7, label: 'A-01', zone: 'kartony' }]
const ACTOR = { name: 'Kierownik (bez logowania)', id: '00000000-0000-0000-0000-000000000001' }

let db: Db

beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
})

beforeEach(async () => {
  await db.exec('TRUNCATE map_paths, audit_log RESTART IDENTITY CASCADE')
})

function validInput() {
  return { name: 'Aisle A', step_length: 0.7, points: POINTS, markers: MARKERS }
}

describe('parseMapPathInput', () => {
  it('przepuszcza poprawną ścieżkę i domyśla długości kroku', () => {
    const input = parseMapPathInput({ name: ' Aisle A ', points: POINTS })
    expect(input.name).toBe('Aisle A')
    expect(input.step_length).toBe(0.7)
    expect(input.markers).toEqual([])
    expect(input.points).toHaveLength(3)
  })

  const invalid: [string, unknown][] = [
    ['brak nazwy', { points: POINTS }],
    ['pusta nazwa', { name: '   ', points: POINTS }],
    ['za długa nazwa', { name: 'x'.repeat(81), points: POINTS }],
    ['za krótka ścieżka', { name: 'A', points: POINTS.slice(0, 1) }],
    ['za dużo punktów', { name: 'A', points: Array.from({ length: 4001 }, () => POINTS[0]) }],
    ['za długi krok', { name: 'A', step_length: 2, points: POINTS }],
    ['nie-skończony współrzędna', { name: 'A', points: [{ x: NaN, y: 0, t: 0 }, POINTS[1]] }],
    ['poza skalą hali', { name: 'A', points: [{ x: 2000, y: 0, t: 0 }, POINTS[1]] }],
    ['punkt nie-obiekt', { name: 'A', points: [42, POINTS[1]] }],
    ['znacznik bez etykiety', { name: 'A', points: POINTS, markers: [{ x: 0, y: 0, label: ' ' }] }],
    ['znaczniki nie-lista', { name: 'A', points: POINTS, markers: 'x' }],
  ]

  for (const [label, body] of invalid) {
    it(`odrzuca: ${label}`, () => {
      try {
        parseMapPathInput(body)
        expect.unreachable('oczekiwano HttpError 422')
      } catch (error) {
        expect((error as { status?: number; name?: string }).name).toBe('HttpError')
        expect((error as { status?: number }).status).toBe(422)
      }
    })
  }

  it('obcina etykietę strefy do 60 znaków', () => {
    const input = parseMapPathInput({
      name: 'A',
      points: POINTS,
      markers: [{ x: 0, y: 0, label: 'A-01', zone: 'z'.repeat(70) }],
    })
    expect(input.markers[0]!.zone).toHaveLength(60)
  })
})

describe('zapis i lista', () => {
  it('zapisuje i zwraca ścieżkę z audytem', async () => {
    const saved = await saveMapPath(db, validInput(), ACTOR)
    expect(saved.id).toBeGreaterThan(0)
    expect(saved.name).toBe('Aisle A')
    expect(saved.points).toEqual(POINTS)
    expect(saved.markers).toEqual(MARKERS)
    expect(saved.step_length).toBe(0.7)
    expect(saved.created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    const listed = await listMapPaths(db)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(saved)

    const audit = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM audit_log WHERE event_type = 'map_path_saved' AND item_name = 'Aisle A'",
    )
    expect(audit[0]!.count).toBe(1)
    const details = await db.query<{ details: string }>(
      "SELECT details FROM audit_log WHERE event_type = 'map_path_saved' LIMIT 1",
    )
    expect(details[0]!.details).toContain('3 pkt')
    expect(details[0]!.details).toContain('1 znaczników')
  })

  it('lista jest pusta dla świeżej bazy', async () => {
    const fresh = await createPgliteDb(null)
    await initDb(fresh)
    expect(await listMapPaths(fresh)).toEqual([])
  })
})

describe('usunięcie', () => {
  it('usuwa ścieżkę i loguje wpis; drugie usunięcie → 404', async () => {
    const saved = await saveMapPath(db, validInput(), DEFAULT_ACTOR)
    await deleteMapPath(db, saved.id, DEFAULT_ACTOR)
    expect(await listMapPaths(db)).toHaveLength(0)

    const audit = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM audit_log WHERE event_type = 'map_path_deleted'",
    )
    expect(audit[0]!.count).toBe(1)

    await expect(deleteMapPath(db, saved.id, DEFAULT_ACTOR)).rejects.toMatchObject({ status: 404 })
  })
})
