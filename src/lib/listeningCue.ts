// Jeden kontekst na kartę; przeglądarka odblokowuje audio po geście użytkownika.
let context: AudioContext | null = null

export function unlockListeningCue(): void {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume().catch(() => {})
  } catch {
    // Brak audio nie blokuje mikrofonu ani tekstowego wskaźnika gotowości.
  }
}

export function playListeningCue(): void {
  if (!context || context.state !== 'running') return
  try {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    oscillator.start(now)
    oscillator.stop(now + 0.12)
  } catch {
    // Sygnał jest dodatkiem; tekst nadal pokazuje rzeczywisty stan mikrofonu.
  }
}
