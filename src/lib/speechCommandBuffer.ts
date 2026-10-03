/** Web Speech can finish "Magu, wzięliśmy" before emitting "paletę bułek". */
export function createSpeechCommandBuffer(submit: (text: string, startMs: number | null) => void, waitMs = 650) {
  let pending: { text: string; startMs: number | null } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  const flush = () => {
    const command = pending
    cancel()
    if (command) submit(command.text, command.startMs)
  }
  const defer = () => {
    if (!pending) return
    clearTimeout(timer)
    timer = setTimeout(flush, waitMs)
  }
  return {
    pending: () => pending !== null,
    cancel,
    defer,
    push(text: string, startMs: number | null, continuation: boolean) {
      if (pending && !continuation) flush()
      clearTimeout(timer)
      pending = pending
        ? { text: `${pending.text} ${text}`, startMs: pending.startMs }
        : { text, startMs }
      defer()
    },
  }
}
