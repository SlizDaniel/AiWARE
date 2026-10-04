export const SPEECH_WINDOW_MS = 3000

/** One deadline from activation. Results, silence and repeated prefixes cannot extend it. */
export function createSpeechWindow(onExpired: () => void, limitMs = SPEECH_WINDOW_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    get active() { return timer !== undefined },
    start() {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        onExpired()
      }, limitMs)
    },
    clear() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
