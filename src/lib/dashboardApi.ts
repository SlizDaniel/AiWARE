// Klient dashboardu kierownika: parametry zapytań, pobieranie (z AbortSignal) i formatowanie
// czasu w strefie magazynu. Kontrakt odpowiedzi: '@/lib/dashboard'.
import { ApiError, apiErrorFromResponse, readApiJson } from './api'
import type {
  ActivityStatus,
  DashboardActivityResponse,
  DashboardResponse,
  ShiftSummaryResponse,
  StockTrendResponse,
} from './dashboard'

export type PresetPeriod = 'today' | '7d' | '30d'
export type PeriodSelection = { kind: 'preset'; period: PresetPeriod } | { kind: 'custom'; from: string; to: string }

/** Filtry dziennika; pusty tekst = brak filtra. */
export type ActivityFilters = {
  actorId: string
  eventType: string
  itemId: string
  q: string
  status: ActivityStatus
}

export const DEFAULT_FILTERS: ActivityFilters = { actorId: '', eventType: '', itemId: '', q: '', status: 'all' }
export const ACTIVITY_PAGE_SIZE = 25
export const MAX_RANGE_DAYS = 366
export const MAX_SHIFT_HOURS = 48
export const MAX_QUERY_LENGTH = 100

export const EVENT_LABELS: Record<string, string> = {
  stock_change: 'Zmiana zapasu',
  inventory_import: 'Import pozycji',
  item_added: 'Dodanie towaru',
  zone_added: 'Dodanie strefy',
  procedure_saved: 'Zapis procedury',
  reorder_draft_created: 'Utworzenie szkicu zamówienia',
  reorder_draft_updated: 'Aktualizacja szkicu zamówienia',
  reorder_cancelled: 'Anulowanie szkicu zamówienia',
  reorder_approved: 'Zatwierdzenie zamówienia',
  reorder_rejected: 'Odrzucenie zamówienia',
}

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? `Inne zdarzenie (${type || 'bez typu'})`
}

export const STATUS_LABELS: Record<Exclude<ActivityStatus, 'all'>, string> = {
  active: 'aktywny',
  undone: 'cofnięty',
  undo: 'korekta cofająca',
}

// --- parametry ----------------------------------------------------------------------

export function periodParams(period: PeriodSelection): URLSearchParams {
  return period.kind === 'preset'
    ? new URLSearchParams({ period: period.period })
    : new URLSearchParams({ from: period.from, to: period.to })
}

/** Okres + filtry dziennika (AND); bez `page`, gdy nie podano (eksport CSV). */
export function activityParams(
  period: PeriodSelection,
  filters: ActivityFilters,
  paging?: { page: number; pageSize: number },
): URLSearchParams {
  const params = periodParams(period)
  if (filters.actorId) params.set('actor_id', filters.actorId)
  if (filters.eventType) params.set('event_type', filters.eventType)
  if (filters.itemId) params.set('item_id', filters.itemId)
  const q = filters.q.trim()
  if (q) params.set('q', q.slice(0, MAX_QUERY_LENGTH))
  params.set('status', filters.status)
  if (paging) {
    params.set('page', String(paging.page))
    params.set('page_size', String(paging.pageSize))
  }
  return params
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Dzień YYYY-MM-DD jako liczba dni (bez strefy — to data kalendarzowa, nie chwila). */
function dayNumber(value: string): number | null {
  if (!DAY_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const time = Date.UTC(year, month - 1, day)
  const check = new Date(time)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return time / 86_400_000
}

/** Dzień kalendarzowy przesunięty o `days` (arytmetyka na datach, bez stref). */
export function addDays(day: string, days: number): string {
  const base = dayNumber(day)
  if (base === null) return day
  return new Date((base + days) * 86_400_000).toISOString().slice(0, 10)
}

/** Komunikat błędu własnego zakresu dni albo null, gdy poprawny. */
export function customRangeError(from: string, to: string): string | null {
  const start = dayNumber(from)
  const end = dayNumber(to)
  if (start === null || end === null) return 'Podaj obie daty (od i do).'
  if (end < start) return 'Data „do” nie może być wcześniejsza niż „od”.'
  if (end - start + 1 > MAX_RANGE_DAYS) return `Zakres może mieć najwyżej ${MAX_RANGE_DAYS} dni.`
  return null
}

// --- czas w strefie magazynu ---------------------------------------------------------

function zoneParts(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

/** Przesunięcie strefy względem UTC (minuty) w danej chwili. */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const p = zoneParts(utcMs, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000)
}

const pad = (value: number) => String(value).padStart(2, '0')

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/**
 * Wartość pola datetime-local („2026-10-03T08:00”) czytana jako czas ścienny w strefie
 * magazynu → ISO z sekundami i offsetem („2026-10-03T08:00:00+02:00”). Null przy złym formacie.
 */
export function zonedInputToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi, s = '00'] = match
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  let offset = zoneOffsetMinutes(wall, timeZone)
  const corrected = zoneOffsetMinutes(wall - offset * 60_000, timeZone)
  if (corrected !== offset) offset = corrected
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${formatOffset(offset)}`
}

/** Chwila (ISO / ms) → wartość pola datetime-local w strefie magazynu. */
export function isoToZonedInput(value: string | number, timeZone: string): string {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  const p = zoneParts(ms, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** Granice własnej zmiany (ISO z offsetem) albo komunikat błędu. */
export function shiftWindow(
  startInput: string,
  endInput: string,
  timeZone: string,
  now = Date.now(),
): { start: string; end: string } | { error: string } {
  const start = zonedInputToIso(startInput, timeZone)
  const end = zonedInputToIso(endInput, timeZone)
  if (!start || !end) return { error: 'Podaj początek i koniec zmiany.' }
  const first = Date.parse(start)
  const last = Date.parse(end)
  if (!(last > first)) return { error: 'Koniec zmiany musi być późniejszy niż początek.' }
  if (last - first > MAX_SHIFT_HOURS * 3_600_000) return { error: `Zmiana może obejmować najwyżej ${MAX_SHIFT_HOURS} godzin.` }
  if (last > now) return { error: 'Koniec zmiany nie może być w przyszłości.' }
  return { start, end }
}

/** Dzień kalendarzowy YYYY-MM-DD do wyświetlenia — bez parsowania jako UTC (bez przesunięcia daty). */
export function formatDay(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const days = dayNumber(value)
  if (days === null) return value
  return new Intl.DateTimeFormat('pl-PL', { ...options, timeZone: 'UTC' }).format(new Date(days * 86_400_000))
}

export function formatRange(range: { from: string; to: string }): string {
  if (range.from === range.to) return formatDay(range.from, { day: 'numeric', month: 'long', year: 'numeric' })
  return `${formatDay(range.from, { day: 'numeric', month: 'short' })} – ${formatDay(range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** Chwila ISO w strefie magazynu. */
export function formatDateTime(value: string, timeZone: string, withSeconds = false): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  }).format(new Date(ms))
}

/** Początek dnia YYYY-MM-DD w strefie (ms UTC) — do osi czasu wykresu. */
export function zonedDayStart(day: string, timeZone: string): number | null {
  const iso = zonedInputToIso(`${day}T00:00`, timeZone)
  return iso ? Date.parse(iso) : null
}

// --- pobieranie ----------------------------------------------------------------------

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'
}

function get<T>(path: string, params: URLSearchParams | null, signal?: AbortSignal): Promise<T> {
  const query = params && [...params.keys()].length ? `?${params}` : ''
  return fetch(`${path}${query}`, { cache: 'no-store', signal }).then((response) => readApiJson<T>(response))
}

export function fetchDashboard(period: PeriodSelection, signal?: AbortSignal): Promise<DashboardResponse> {
  return get('/api/dashboard', periodParams(period), signal)
}

export function fetchActivity(
  period: PeriodSelection,
  filters: ActivityFilters,
  page: number,
  signal?: AbortSignal,
  pageSize = ACTIVITY_PAGE_SIZE,
): Promise<DashboardActivityResponse> {
  return get('/api/dashboard/activity', activityParams(period, filters, { page, pageSize }), signal)
}

/** Ostatnie 8 h (bez parametrów) albo własne granice ISO z offsetem. */
export function fetchShift(window: { start: string; end: string } | null, signal?: AbortSignal): Promise<ShiftSummaryResponse> {
  return get('/api/dashboard/shift', window ? new URLSearchParams(window) : null, signal)
}

export function fetchTrend(itemId: number, period: PeriodSelection, signal?: AbortSignal): Promise<StockTrendResponse> {
  return get(`/api/dashboard/items/${encodeURIComponent(String(itemId))}/trend`, periodParams(period), signal)
}

/** CSV dziennika (te same filtry, bez stronicowania). Błąd 413/422 to JSON — nigdy nie trafia do pliku. */
export async function exportActivityCsv(period: PeriodSelection, filters: ActivityFilters, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/dashboard/activity/export?${activityParams(period, filters)}`, { cache: 'no-store', signal })
  if (!response.ok) throw await apiErrorFromResponse(response)
  const type = response.headers.get('Content-Type') ?? ''
  if (type.includes('application/json')) throw new ApiError(response.status, 'Serwer nie zwrócił pliku CSV.')
  return response.blob()
}

/** Pobranie pliku z bloba (link <a download> w pamięci). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Komunikat dla użytkownika zależny od kodu odpowiedzi (zawsze z treścią z serwera). */
export function describeError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  if (error instanceof ApiError) {
    if (error.status === 503) return `Usługa chwilowo niedostępna: ${error.message}`
    if (error.status === 413 || error.status === 422) return `${error.message}`
    if (error.status === 404) return error.message || 'Nie znaleziono.'
  }
  return error.message || fallback
}
