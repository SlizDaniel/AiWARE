/**
 * Łączy segmenty jednej wypowiedzi; wynik końcowy STT nie musi być końcem komendy.
 * `onInterimIdle` — wynik pośredni bez zmian przez `idleMs`: człowiek skończył mówić, a przeglądarka
 * jeszcze nie zamknęła wyniku (nasłuchujący może wtedy zatrzymać rozpoznawanie, by go domknąć).
 */
export function createSpeechCommandBuffer(
  onReady: (text: string, startMs: number | null) => void,
  pauseMs = 1000,
  onInterimIdle?: () => void,
  idleMs = 1500,
) {
  const segments = new Map<number, { text: string; final: boolean; startMs: number | null }>()
  const normalized = (text: string) => text.toLocaleLowerCase('pl-PL').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  const ordered = () => [...segments.entries()].sort(([left], [right]) => left - right).map(([, segment]) => segment)
  const preview = () => ordered().map(segment => segment.text).filter(Boolean).join(' ')
  const clear = () => {
    clearTimeout(timer)
    clearTimeout(idle)
    timer = undefined
    idle = undefined
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
    /** Wysyła bieżący tekst także z wynikiem pośrednim (po zatrzymaniu rozpoznawania przez ciszę). */
    finish() {
      const text = preview()
      const startMs = ordered().find(segment => segment.startMs !== null)?.startMs ?? null
      clear()
      if (text) onReady(text, startMs)
    },
    endSession() {
      // Keep the final-result silence timer. Incomplete speech is discarded whole,
      // so an unfinished qualifier cannot turn into a shorter stock operation.
      if ([...segments.values()].some(segment => !segment.final)) clear()
    },
    get pending() { return segments.size > 0 },
    update(index: number, text: string, final: boolean, startMs: number | null, startsCommand = false): string {
      // Nowy prefiks zastępuje jeszcze niewysłaną komendę. Rewizja tego samego
      // indeksu nadal należy do jednej wypowiedzi i zachowuje początek nagrania.
      if (startsCommand && !segments.has(index)) clear()
      const previous = segments.get(index)
      // Przeglądarka powtarza niezmienione wyniki — to nie nowa mowa, nie może odsuwać wysłania.
      if (previous && previous.text === text && previous.final === final) return preview()
      clearTimeout(timer)
      clearTimeout(idle)
      timer = idle = undefined
      segments.set(index, { text, final, startMs: previous?.startMs ?? startMs })
      // Wynik końcowy może przyjść pod nowym indeksem (np. po stop()) — stary wynik pośredni
      // tego samego fragmentu nie może zostać obok, bo słowo wyszłoby podwójnie („bułek bułek”).
      if (final) {
        const words = normalized(text)
        for (const [other, segment] of segments) {
          if (other === index || segment.final) continue
          const tail = normalized(segment.text)
          if (other < index || (tail && (words === tail || words.endsWith(` ${tail}`)))) segments.delete(other)
        }
      }
      if ([...segments.values()].every(segment => segment.final)) timer = setTimeout(flush, pauseMs)
      else if (onInterimIdle) idle = setTimeout(onInterimIdle, idleMs)
      return preview()
    },
  }
}
