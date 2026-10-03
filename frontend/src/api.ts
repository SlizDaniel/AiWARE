// Klient API backendu MAGAZYNIER (kontrakt: karta zmiany / confirm / audyt).

export type Item = {
  id: number
  name: string
  quantity: number
  minimum: number
  unit: string
  location: string
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
}

export type Proposal = {
  id: string
  tool: string
  item_id: number
  item_name: string
  unit: string
  delta: number
  before: number
  after: number
  summary: string
  text: string
}

export type CommandResponse =
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'unknown'; text: string }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function fetchStock(): Promise<Item[]> {
  return fetch('/api/stock').then((r) => json<{ items: Item[] }>(r)).then((d) => d.items)
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

export function confirmProposal(id: string): Promise<{ applied: boolean; audit_id: number }> {
  return fetch(`/api/proposals/${id}/confirm`, { method: 'POST' }).then((r) =>
    json<{ applied: boolean; audit_id: number }>(r),
  )
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
