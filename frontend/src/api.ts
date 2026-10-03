// Klient API backendu MAGAZYNIER (kontrakt: karta zmiany / confirm / audyt).

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
}

export type ReorderDraft = {
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
  missing_required: ImportField[]
  warnings: string[]
}

async function json<T>(res: Response): Promise<T> {
  const payload = await res.json()
  if (!res.ok) {
    const detail = payload && typeof payload.detail === 'string' ? payload.detail : `${res.status} ${res.statusText}`
    throw new Error(detail)
  }
  return payload as T
}

export function fetchStock(): Promise<Item[]> {
  return fetch('/api/stock').then((r) => json<{ items: Item[] }>(r)).then((d) => d.items)
}

export function fetchZones(): Promise<Zone[]> {
  return fetch('/api/zones').then((r) => json<{ zones: Zone[] }>(r)).then((d) => d.zones)
}

export function fetchHistory(): Promise<HistoryEntry[]> {
  return fetch('/api/history').then((r) => json<{ entries: HistoryEntry[] }>(r)).then((d) => d.entries)
}

export function sendCommand(text: string): Promise<CommandResponse> {
  return fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then((r) => json<CommandResponse>(r))
}

export function fetchAgentMode(): Promise<AgentModeStatus> {
  return fetch('/api/agent-mode').then((r) => json<AgentModeStatus>(r))
}

export function updateAgentMode(mode: AgentMode): Promise<AgentModeStatus> {
  return fetch('/api/agent-mode', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  }).then((r) => json<AgentModeStatus>(r))
}

export function confirmProposal(id: string): Promise<{
  applied: boolean
  audit_id?: number
  reorder_draft?: ReorderDraft | null
}> {
  return fetch(`/api/proposals/${id}/confirm`, { method: 'POST' }).then((r) =>
    json<{ applied: boolean; audit_id?: number; reorder_draft?: ReorderDraft | null }>(r),
  )
}

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
  return fetch(`/api/reorder-drafts/${id}/reject`, { method: 'POST' }).then((r) =>
    json<{ rejected: boolean }>(r),
  )
}

export async function previewInventoryFile(file: File): Promise<ImportPreview> {
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
  return fetch('/api/import/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ import_id: importId, mapping }),
  }).then((response) => json<{ inserted: number; updated: number; total: number }>(response))
}

// WebSocket: push {"event": "updated"} po każdej zatwierdzonej zmianie.
export function connectWs(onUpdated: () => void, onStatus: (connected: boolean) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => onStatus(true)
    ws.onclose = () => {
      onStatus(false)
      if (!closed) retry = setTimeout(open, 1500)
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.event === 'updated') onUpdated()
      } catch {
        /* ignoruj nie-JSON */
      }
    }
  }
  open()

  return () => {
    closed = true
    if (retry) clearTimeout(retry)
  }
}
