/** Łączy segmenty jednej wypowiedzi; wynik końcowy STT nie musi być końcem komendy. */
export function createSpeechCommandBuffer(onReady: (text: string, startMs: number | null) => void, pauseMs = 1000) {
  const segments = new Map<number, { text: string; final: boolean; startMs: number | null }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const preview = () => [...segments.values()].map(segment => segment.text).filter(Boolean).join(' ')
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
    segments.clear()
  }
  const flush = () => {
    if (!segments.size || [...segments.values()].some(segment => !segment.final)) return
    const text = preview()
    const startMs = [...segments.values()].find(segment => segment.startMs !== null)?.startMs ?? null
    clear()
    if (text) onReady(text, startMs)
  }
  return {
    clear,
    flush,
    get pending() { return segments.size > 0 },
    update(index: number, text: string, final: boolean, startMs: number | null, startsCommand = false): string {
      // Nowy prefiks zastępuje jeszcze niewysłaną komendę. Rewizja tego samego
      // indeksu nadal należy do jednej wypowiedzi i zachowuje początek nagrania.
      if (startsCommand && !segments.has(index)) clear()
      clearTimeout(timer)
      segments.set(index, { text, final, startMs: segments.get(index)?.startMs ?? startMs })
      if ([...segments.values()].every(segment => segment.final)) timer = setTimeout(flush, pauseMs)
      return preview()
    },
  }
}
