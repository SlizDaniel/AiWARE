// Klient API backendu MAGAZYNIER (kontrakt: karta zmiany / confirm / audyt).
// Błędy mają kształt {"detail": "..."}; 401 → /login (tylko gdy logowanie jest włączone),
// 403 → komunikat serwera trafia do nasłuchujących (AppShell pokazuje go w toaście).
import type { ClarificationTurn } from './commandConversation'
import type { PathMarker, PathPoint } from './pdr'

export type { PathMarker, PathPoint }

/** Zapisana ścieżka z mapowania hali (kontrakt GET/POST /api/map-paths). */
export type MapPath = {
  id: number
  name: string
  points: PathPoint[]
  markers: PathMarker[]
  step_length: number
  actor: string
  created: string
}

export type Item = {
  id: number
  name: string
  quantity: number
  minimum: number
  unit: string
  location: string
}

export type Zone = {
  id: number
  name: string
  created: string
}

export type Procedure = {
  id: number
  topic: string
  text: string
  created: string
  item_id?: number
  packaging_id?: number
  quantity_per_package?: number
  notes?: string
  packaging_name?: string
  version?: number
  updated_by?: string
  packaging_stock?: { name: string; quantity: number; unit: string } | null
}

export type Packaging = { id: number; name: string; inventory_item_id: number | null }
export type PackingInput = { item_id: number; packaging_id: number; quantity_per_package: number; notes: string }

export type HistoryEntry = {
  id: number
  ts: string
  actor: string
  text: string
  item_name: string
  delta: number
  before: number
  after: number
  event_type: 'stock_change' | 'reorder_draft_created' | 'reorder_approved' | 'reorder_rejected' | string
  details: string
  /** id wpisu, który ten wpis cofa (wpis „cofnięcie”) */
  undo_of: number | null
  /** id wpisu, który cofnął ten wpis (wpis „cofnięty”) */
  undone_by: number | null
}

export type ReorderDraft = {
  created?: boolean
  id: number
  item_id: number
  item_name: string
  quantity: number
  unit: string
  deliver_on: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  updated_at: string
}

export type Proposal = {
  id: string
  tool: string
  args?: Record<string, unknown>
  item_id?: number
  item_name?: string
  unit?: string
  delta?: number
  before?: number
  after?: number
  summary: string
  text: string
}

export type CommandResponse =
  | { type: 'proposal'; proposal: Proposal; warning?: string }
  | { type: 'answer'; tool: string; text: string; data: Record<string, unknown>; warning?: string }
  | { type: 'clarify'; text: string; message: string; warning?: string }
  | { type: 'unknown'; text: string; hints?: string[]; warning?: string }

export type AgentMode = 'llm' | 'offline' | 'mock'
export type AgentModeStatus = {
  demo_mode: boolean
  mode: AgentMode
  effective_mode: AgentMode
  llm_available: boolean
  warning: string | null
}

export type ImportField = 'name' | 'quantity' | 'minimum' | 'location' | 'unit'
export type ImportPreview = {
  import_id: string
  headers: { index: number; label: string }[]
  preview: string[][]
  row_count: number
  mapping: Record<ImportField, { column: number | null; confidence: number }>
  mapping_source: 'llm' | 'rules'
  missing_required: ImportField[]
  warnings: string[]
}

/** `oczekujacy` — konto czeka na zatwierdzenie przez kierownika (brak dostępu do danych). */
export type Role = 'pracownik' | 'kierownik' | 'oczekujacy'
export type AuthMode = 'supabase' | 'disabled' | 'misconfigured'

export type CurrentUser = {
  id: string
  email: string
  display_name: string
  role: Role
}

export type Me = {
  user: CurrentUser | null
  auth_mode: AuthMode
}

export type StorageKind = 'supabase' | 'postgres' | 'pglite' | 'ephemeral'

export type Health = {
  status: string
  mode: AgentMode | string
  demo_mode: boolean
  storage: StorageKind
  auth_mode: AuthMode
  llm_model: string
  stt_model: string
}

export type DataAdapter = 'database' | 'file_import'
export type VoiceMode = 'push_to_talk' | 'wake_word' | 'text'

/** Wartości zapisywane przez PATCH /api/settings (każde pole opcjonalne w zmianie). */
export type SettingsValues = {
  prefix: string
  mode: AgentMode
  adapter: DataAdapter
  default_minimum: number
  voice_mode: VoiceMode
  tts_enabled: boolean
  reorder_default_quantity: number
  /** Poprawianie tekstu z przeglądarki transkrypcją serwera (domyślnie wyłączone). */
  stt_refine: boolean
}

export type AiUsage = {
  llm_model: string
  llm_provider: string
  llm_enabled: boolean
  stt_model: string
  stt_provider: string
  stt_enabled: boolean
  disclosure: string
}

export type AppSettings = SettingsValues & {
  mode_status: AgentModeStatus
  version: string
  ai_usage: AiUsage
}

export type UserAccount = CurrentUser & { created_at: string }

export type UndoResult = {
  audit_id: number
  item_name: string
  delta: number
  before: number
  after: number
  reorder_draft: ReorderDraft | null
  undo_of: number
}

/** Limit treści żądania po stronie serwera (Vercel tnie ciała > 4,5 MB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

export const ROLE_LABELS: Record<Role, string> = {
  kierownik: 'Kierownik',
  pracownik: 'Pracownik',
  oczekujacy: 'Oczekuje na zatwierdzenie',
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

// --- sesja / uprawnienia -------------------------------------------------------

let knownAuthMode: AuthMode | null = null
let redirecting = false
const forbiddenListeners = new Set<(detail: string) => void>()

/** Rejestruje odbiorcę komunikatów 403 (brak uprawnień roli). Zwraca funkcję wypisania. */
export function onApiForbidden(listener: (detail: string) => void): () => void {
  forbiddenListeners.add(listener)
  return () => {
    forbiddenListeners.delete(listener)
  }
}

function redirectToLogin() {
  // 401 zwracają tylko trasy z włączonym logowaniem; gdy /api/me już powiedziało,
  // że logowanie jest wyłączone, nie przekierowujemy (uniknięcie pętli).
  if (knownAuthMode !== null && knownAuthMode !== 'supabase') return
  if (redirecting || typeof window === 'undefined') return
  if (window.location.pathname.startsWith('/login')) return
  redirecting = true
  window.location.assign('/login')
}

/**
 * Błąd z odpowiedzi nie-OK ({"detail": "..."}) z obsługą sesji: 401 → /login, 403 → nasłuchujący.
 * Do użycia także przy odpowiedziach innych niż JSON (np. eksport CSV).
 */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  const detail = record && typeof record.detail === 'string' ? record.detail : `${res.status} ${res.statusText}`.trim()
  if (res.status === 401) redirectToLogin()
  if (res.status === 403) forbiddenListeners.forEach((listener) => listener(detail))
  return new ApiError(res.status, detail)
}

/** JSON z odpowiedzi API albo ApiError (z tą samą obsługą 401/403 co reszta klienta). */
export async function readApiJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await apiErrorFromResponse(res)
  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  if (payload === null) throw new ApiError(res.status, 'Serwer zwrócił nieprawidłową odpowiedź.')
  return payload as T
}

const json = readApiJson

function sendJson(method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// --- konto, zdrowie, ustawienia -----------------------------------------------

export async function fetchMe(): Promise<Me> {
  const me = await fetch('/api/me', { cache: 'no-store' }).then((r) => json<Me>(r))
  knownAuthMode = me.auth_mode
  return me
}

export function fetchHealth(): Promise<Health> {
  return fetch('/api/health', { cache: 'no-store' }).then((r) => json<Health>(r))
}

export function fetchVersion(): Promise<number> {
  return fetch('/api/version', { cache: 'no-store' })
    .then((r) => json<{ version: number }>(r))
    .then((d) => d.version)
}

export function fetchSettings(): Promise<AppSettings> {
  return fetch('/api/settings', { cache: 'no-store' }).then((r) => json<AppSettings>(r))
}

/** Zapis tylko zmienionych pól (kierownik). 422 = błędne pole, nic nie zapisano; 409 = tryb demo. */
export function saveSettings(changes: Partial<SettingsValues>): Promise<AppSettings> {
  return fetch('/api/settings', sendJson('PATCH', changes)).then((r) => json<AppSettings>(r))
}

export function fetchUsers(): Promise<UserAccount[]> {
  return fetch('/api/users', { cache: 'no-store' })
    .then((r) => json<{ users: UserAccount[] }>(r))
    .then((d) => d.users)
}

export function updateUserRole(id: string, role: Role): Promise<UserAccount> {
  return fetch(`/api/users/${encodeURIComponent(id)}/role`, sendJson('PUT', { role }))
    .then((r) => json<{ user: UserAccount }>(r))
    .then((d) => d.user)
}

// --- magazyn ----------------------------------------------------------------------

export function fetchStock(): Promise<Item[]> {
  return fetch('/api/stock').then((r) => json<{ items: Item[] }>(r)).then((d) => d.items)
}

export function updateStockItem(id: number, changes: Partial<Omit<Item, 'id'>>): Promise<Item> {
  return fetch(`/api/stock/${id}`, sendJson('PATCH', changes))
    .then((r) => json<{ item: Item }>(r))
    .then((d) => d.item)
}

export function fetchZones(): Promise<Zone[]> {
  return fetch('/api/zones').then((r) => json<{ zones: Zone[] }>(r)).then((d) => d.zones)
}

// --- mapowanie hali (ścieżki z telefonu, PDR) --------------------------------------

export function fetchMapPaths(): Promise<MapPath[]> {
  return fetch('/api/map-paths', { cache: 'no-store' })
    .then((r) => json<{ paths: MapPath[] }>(r))
    .then((d) => d.paths)
}

export function saveMapPath(input: { name: string; step_length: number; points: PathPoint[]; markers: PathMarker[] }): Promise<MapPath> {
  return fetch('/api/map-paths', sendJson('POST', input)).then((r) => json<{ path: MapPath }>(r)).then((d) => d.path)
}

export function deleteMapPath(id: number): Promise<void> {
  return fetch(`/api/map-paths/${id}`, { method: 'DELETE' }).then((r) => json<{ deleted: number }>(r)).then(() => undefined)
}

// --- sektory na zmapowanej mapie -----------------------------------------------

/** Przypisanie przedmiotu do sektora (rozmieszczenie — nie zmienia stanu magazynu). */
export type MapSectorItem = { item_id: number; item_name: string; unit: string; quantity: number }

export type MapSector = {
  id: number
  name: string
  x: number
  y: number
  actor: string
  created: string
  items: MapSectorItem[]
}

export function fetchMapSectors(): Promise<MapSector[]> {
  return fetch('/api/map-sectors', { cache: 'no-store' })
    .then((r) => json<{ sectors: MapSector[] }>(r))
    .then((d) => d.sectors)
}

export function createMapSector(input: { name: string; x: number; y: number }): Promise<MapSector> {
  return fetch('/api/map-sectors', sendJson('POST', input)).then((r) => json<{ sector: MapSector }>(r)).then((d) => d.sector)
}

export function deleteMapSector(id: number): Promise<void> {
  return fetch(`/api/map-sectors/${id}`, { method: 'DELETE' }).then((r) => json<{ deleted: number }>(r)).then(() => undefined)
}

export function assignSectorItem(sectorId: number, input: { item_id: number; quantity: number }): Promise<MapSector> {
  return fetch(`/api/map-sectors/${sectorId}/items`, sendJson('PUT', input)).then((r) => json<{ sector: MapSector }>(r)).then((d) => d.sector)
}

export function unassignSectorItem(sectorId: number, itemId: number): Promise<MapSector> {
  return fetch(`/api/map-sectors/${sectorId}/items/${itemId}`, { method: 'DELETE' })
    .then((r) => json<{ sector: MapSector }>(r)).then((d) => d.sector)
}

export function fetchProcedures(): Promise<Procedure[]> {
  return fetch('/api/procedures').then((r) => json<{ procedures: Procedure[] }>(r)).then((d) => d.procedures)
}

export function fetchPackaging(): Promise<Packaging[]> {
  return fetch('/api/packaging', { cache: 'no-store' }).then((r) => json<{ packaging: Packaging[] }>(r)).then((d) => d.packaging)
}

export function linkPackaging(id: number, inventory_item_id: number | null): Promise<Packaging[]> {
  return fetch('/api/packaging', sendJson('PATCH', { id, inventory_item_id }))
    .then((r) => json<{ packaging: Packaging[] }>(r)).then((d) => d.packaging)
}

export function proposePackingRule(input: PackingInput & { expected_version?: number }): Promise<Proposal> {
  return fetch('/api/procedures', sendJson('POST', input)).then((r) => json<{ proposal: Proposal }>(r)).then((d) => d.proposal)
}

export function fetchHistory(): Promise<HistoryEntry[]> {
  return fetch('/api/history').then((r) => json<{ entries: HistoryEntry[] }>(r)).then((d) => d.entries)
}

export function undoHistoryEntry(id: number): Promise<UndoResult> {
  return fetch(`/api/history/${id}/undo`, { method: 'POST' }).then((r) => json<UndoResult>(r))
}

export function sendCommand(text: string, conversation: ClarificationTurn[] = []): Promise<CommandResponse> {
  return fetch('/api/command', sendJson('POST', { text, conversation })).then((r) => json<CommandResponse>(r))
}

export function fetchAgentMode(): Promise<AgentModeStatus> {
  return fetch('/api/agent-mode', { cache: 'no-store' }).then((r) => json<AgentModeStatus>(r))
}

export function updateAgentMode(mode: AgentMode): Promise<AgentModeStatus> {
  return fetch('/api/agent-mode', sendJson('PUT', { mode })).then((r) => json<AgentModeStatus>(r))
}

export type ConfirmResult = {
  applied: boolean
  audit_id?: number
  reorder_draft?: ReorderDraft | null
  created?: boolean
  id?: number
  name?: string
}

export function confirmProposal(id: string): Promise<ConfirmResult> {
  return fetch(`/api/proposals/${encodeURIComponent(id)}/confirm`, { method: 'POST' }).then((r) =>
    json<ConfirmResult>(r),
  )
}

// --- głos (STT) -----------------------------------------------------------------

const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
}

/** Prawdziwy typ MIME nagrania (bez parametrów kodeka) i pasujące rozszerzenie pliku. */
export function audioUploadInfo(type: string): { mime: string; ext: string } {
  const base = type.split(';')[0].trim().toLowerCase()
  if (base === 'video/webm') return { mime: 'audio/webm', ext: 'webm' }
  if (base === 'video/mp4') return { mime: 'audio/mp4', ext: 'mp4' }
  if (base === 'audio/wave' || base === 'audio/vnd.wave') return { mime: 'audio/wav', ext: 'wav' }
  const ext = AUDIO_TYPES[base]
  return ext ? { mime: base, ext } : { mime: 'audio/webm', ext: 'webm' }
}

// Audio z mikrofonu → transkrypcja (Gemini po stronie serwera).
// Błąd STT (np. 503) rzuca Error z polskim komunikatem — UI podświetla pole tekstowe.
export type SpeechTranscription = { text: string; original_text?: string; corrections?: { heard: string; name: string }[] }

export async function transcribeAudio(blob: Blob): Promise<string> {
  return (await transcribeAudioDetailed(blob)).text
}

export async function transcribeAudioDetailed(blob: Blob): Promise<SpeechTranscription> {
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('Nagranie przekracza limit 4 MB — nagraj krótszą komendę lub wpisz ją ręcznie.')
  }
  const { mime, ext } = audioUploadInfo(blob.type)
  const response = await fetch(`/api/stt?filename=audio.${ext}`, {
    method: 'POST',
    headers: { 'Content-Type': mime },
    body: blob,
  })
  return json<SpeechTranscription>(response)
}

// --- kolejka zamówień -------------------------------------------------------------

export function fetchReorderDrafts(): Promise<ReorderDraft[]> {
  return fetch('/api/reorder-drafts')
    .then((r) => json<{ drafts: ReorderDraft[] }>(r))
    .then((d) => d.drafts)
}

export function approveReorderDraft(id: number): Promise<{ approved: boolean; sent_to_erp: boolean }> {
  return fetch(`/api/reorder-drafts/${id}/approve`, { method: 'POST' }).then((r) =>
    json<{ approved: boolean; sent_to_erp: boolean }>(r),
  )
}

export function rejectReorderDraft(id: number): Promise<{ rejected: boolean }> {
  return fetch(`/api/reorder-drafts/${id}/reject`, { method: 'POST' }).then((r) => json<{ rejected: boolean }>(r))
}

// --- import / eksport -------------------------------------------------------------

export async function previewInventoryFile(file: File): Promise<ImportPreview> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Plik przekracza limit 4 MB. Podziel go na mniejsze części albo usuń zbędne arkusze.')
  }
  const response = await fetch(`/api/import/preview?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  return json<ImportPreview>(response)
}

export function confirmInventoryImport(
  importId: string,
  mapping: Record<ImportField, number | null>,
): Promise<{ inserted: number; updated: number; total: number }> {
  return fetch('/api/import/confirm', sendJson('POST', { import_id: importId, mapping })).then((response) =>
    json<{ inserted: number; updated: number; total: number }>(response),
  )
}
