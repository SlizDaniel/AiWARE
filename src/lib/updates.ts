// Odświeżanie na żywo bez WebSocketu (Vercel serverless): co kilka sekund pytamy
// GET /api/version. Pierwsza wartość to punkt odniesienia; każda zmiana → onUpdated.
// Karta w tle nie odpytuje serwera; powrót do karty lub fokus okna → natychmiastowe zapytanie.
import { fetchVersion } from './api'

export const POLL_INTERVAL_MS = 3000

export type UpdatesOptions = {
  intervalMs?: number
  fetchVersion?: () => Promise<number>
}

export function subscribeUpdates(
  onUpdated: () => void,
  onStatus: (ok: boolean) => void,
  options: UpdatesOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const loadVersion = options.fetchVersion ?? fetchVersion
  const doc = typeof document === 'undefined' ? null : document
  const win = typeof window === 'undefined' ? null : window

  let baseline: number | null = null
  let lastStatus: boolean | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let stopped = false

  const hidden = () => doc?.hidden === true

  const report = (ok: boolean) => {
    if (ok === lastStatus) return
    lastStatus = ok
    onStatus(ok)
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (stopped || hidden()) return
    timer = setTimeout(() => void poll(), intervalMs)
  }

  const poll = async () => {
    if (stopped || inFlight || hidden()) return
    inFlight = true
    try {
      const version = await loadVersion()
      if (stopped) return
      report(true)
      if (baseline === null) baseline = version
      else if (version !== baseline) {
        baseline = version
        onUpdated()
      }
    } catch {
      if (!stopped) report(false)
    } finally {
      inFlight = false
      schedule()
    }
  }

  const wake = () => {
    if (stopped || hidden()) return
    if (timer) clearTimeout(timer)
    timer = undefined
    void poll()
  }

  doc?.addEventListener('visibilitychange', wake)
  win?.addEventListener('focus', wake)
  void poll()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = undefined
    doc?.removeEventListener('visibilitychange', wake)
    win?.removeEventListener('focus', wake)
  }
}
