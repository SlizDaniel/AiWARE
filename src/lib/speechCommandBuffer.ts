/** Łączy segmenty jednej wypowiedzi; wynik końcowy STT nie musi być końcem komendy. */
export function createSpeechCommandBuffer(
  onReady: (text: string, startMs: number | null) => void,
  pauseMs = 1000,
  onInterimIdle?: () => void,
  sampling?: { intervalMs: number; maxMs: number; readQuestion?: (text: string) => string | null; retainInterim?: boolean },
) {
  const segments = new Map<number, { text: string; final: boolean; startMs: number | null }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let sampler: ReturnType<typeof setInterval> | undefined
  let startedAt = 0
  let changedAt = 0
  let closing = false
  const ordered = () => [...segments.entries()].sort(([left], [right]) => left - right).map(([, segment]) => segment)
  const preview = () => ordered().map(segment => segment.text).filter(Boolean).join(' ')
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
    clearInterval(sampler)
    sampler = undefined
    closing = false
    segments.clear()
  }
  const flush = () => {
    if (!segments.size || [...segments.values()].some(segment => !segment.final)) return
    const text = preview()
    const startMs = ordered().find(segment => segment.startMs !== null)?.startMs ?? null
    clear()
    if (text) onReady(text, startMs)
  }
  return {
    clear,
    flush,
    finish(allowInterim = false): boolean {
      if (!segments.size || (!allowInterim && [...segments.values()].some(segment => !segment.final))) {
        clear()
        return false
      }
      const text = preview()
      const startMs = ordered().find(segment => segment.startMs !== null)?.startMs ?? null
      clear()
      if (!text) return false
      onReady(text, startMs)
      return true
    },
    endSession() {
      // Keep the final-result silence timer. Incomplete speech is discarded whole,
      // so an unfinished qualifier cannot turn into a shorter stock operation.
      if ([...segments.values()].some(segment => !segment.final)) {
        if (sampling?.retainInterim) return
        const question = sampling?.readQuestion?.(preview())
        const startMs = ordered().find(segment => segment.startMs !== null)?.startMs ?? null
        clear()
        if (question) onReady(question, startMs)
      }
    },
    get pending() { return segments.size > 0 },
    update(index: number, text: string, final: boolean, startMs: number | null, startsCommand = false): string {
      // Nowy prefiks zastępuje jeszcze niewysłaną komendę. Rewizja tego samego
      // indeksu nadal należy do jednej wypowiedzi i zachowuje początek nagrania.
      if (startsCommand && !segments.has(index)) clear()
      const previous = segments.get(index)
      // Repeated identical interim results are not new speech and must not keep
      // the microphone open indefinitely.
      if (previous?.text === text && previous.final === final) return preview()
      clearTimeout(timer)
      segments.set(index, { text, final, startMs: segments.get(index)?.startMs ?? startMs })
      if (sampling) {
        changedAt = Date.now()
        if (!sampler) {
          startedAt = changedAt
          sampler = setInterval(() => {
            const question = sampling.readQuestion?.(preview())
            if (question) {
              const startMs = ordered().find(segment => segment.startMs !== null)?.startMs ?? null
              clear()
              onReady(question, startMs)
              return
            }
            const allFinal = [...segments.values()].every(segment => segment.final)
            if (allFinal && Date.now() - changedAt >= pauseMs) flush()
            else if (!closing && (Date.now() - startedAt >= sampling.maxMs || (!allFinal && Date.now() - changedAt >= pauseMs + 500))) {
              closing = true
              onInterimIdle?.()
            }
          }, sampling.intervalMs)
        }
        return preview()
      }
      if ([...segments.values()].every(segment => segment.final)) timer = setTimeout(flush, pauseMs)
      else if (onInterimIdle) timer = setTimeout(onInterimIdle, pauseMs + 500)
      return preview()
    },
  }
}
