// Nagrywanie mikrofonu do bufora PCM (mono, 16 kHz, ostatnie ~30 s) — z niego wycinamy
// fragment wypowiedzi i wysyłamy jako WAV do transkrypcji na serwerze (/api/stt).
// AudioWorklet (moduł z Blob URL), a gdy go brak — ScriptProcessor.

export const TARGET_SAMPLE_RATE = 16_000
export const BUFFER_SECONDS = 30

// --- czyste funkcje -----------------------------------------------------------------

export type Resampler = { push(chunk: Float32Array): Float32Array }

/**
 * Strumieniowe zmniejszanie częstotliwości próbkowania: każda próbka wyjściowa to średnia
 * próbek wejściowych z jej przedziału (prosty filtr antyaliasingowy). Pozycja ułamkowa
 * przechodzi między kawałkami, więc 44,1 kHz → 16 kHz nie dryfuje. Bez nadpróbkowania:
 * gdy `toRate >= fromRate`, próbki przechodzą bez zmian.
 */
export function createResampler(fromRate: number, toRate: number): Resampler {
  if (!(fromRate > toRate)) return { push: (chunk) => chunk.slice() }
  // granice przedziałów liczone z liczników (bez sumowania ułamków): próbka wyjściowa nr k
  // kończy się po wejściowej, dla której position * toRate >= (k + 1) * fromRate
  let position = 0
  let emitted = 0
  let sum = 0
  let count = 0
  return {
    push(chunk) {
      const out = new Float32Array(Math.ceil((chunk.length * toRate) / fromRate) + 1)
      let written = 0
      for (let index = 0; index < chunk.length; index++) {
        sum += chunk[index]
        count++
        position++
        if (position * toRate >= (emitted + 1) * fromRate) {
          out[written++] = sum / count
          emitted++
          sum = 0
          count = 0
        }
      }
      return out.slice(0, written)
    },
  }
}

export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  return createResampler(fromRate, toRate).push(input)
}

/** WAV 16-bit PCM mono (44 B nagłówka + 2 B na próbkę: 30 s przy 16 kHz ≈ 0,96 MB). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // rozmiar bloku fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bajty na sekundę
  view.setUint16(32, 2, true) // bajty na próbkę
  view.setUint16(34, 16, true) // bity na próbkę
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index] || 0))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

export function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' })
}

/** Bufor cykliczny: pamięta ostatnie `capacity` próbek, indeksy liczone od początku nagrania. */
export class PcmRing {
  private readonly data: Float32Array
  private total = 0

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity)
  }

  /** Liczba próbek zapisanych od startu (zegar nagrania). */
  get written(): number {
    return this.total
  }

  write(chunk: Float32Array) {
    const source = chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk
    this.total += chunk.length - source.length
    let offset = this.total % this.capacity
    let remaining = source
    while (remaining.length) {
      const part = remaining.subarray(0, this.capacity - offset)
      this.data.set(part, offset)
      this.total += part.length
      remaining = remaining.subarray(part.length)
      offset = 0
    }
  }

  /** Kopia próbek [from, to) przyciętych do tego, co jeszcze jest w buforze. */
  slice(from: number, to: number): Float32Array {
    const start = Math.max(Math.floor(from), this.total - this.capacity, 0)
    const end = Math.min(Math.floor(to), this.total)
    if (end <= start) return new Float32Array(0)
    const out = new Float32Array(end - start)
    for (let index = start, target = 0; index < end; index++, target++) out[target] = this.data[index % this.capacity]
    return out
  }
}

// --- nagrywanie z mikrofonu ------------------------------------------------------------

const WORKLET_NAME = 'magazynier-pcm-capture'
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.filled = 0 }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i]
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer])
          this.buffer = new Float32Array(2048)
          this.filled = 0
        }
      }
    }
    return true
  }
}
registerProcessor('${WORKLET_NAME}', PcmCapture)
`

type AudioContextConstructor = new () => AudioContext

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

export function pcmRecordingSupported(): boolean {
  return (
    audioContextConstructor() !== null &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

export class PcmRecorder {
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioNode | null = null
  private detachNode: (() => void) | null = null
  private sink: GainNode | null = null
  private stream: MediaStream | null = null
  private ownsStream = false
  private ring: PcmRing | null = null
  private resampler: Resampler | null = null
  private starting: Promise<void> | null = null
  private generation = 0
  private unlock: (() => void) | null = null
  sampleRate = TARGET_SAMPLE_RATE

  get isRunning(): boolean {
    return this.context !== null
  }

  /** Startuje nagrywanie (własny strumień z mikrofonu, gdy nie podano). Ponowne wywołanie nic nie robi. */
  start(stream?: MediaStream): Promise<void> {
    if (this.context) return Promise.resolve()
    if (!this.starting) {
      this.starting = this.open(stream).finally(() => {
        this.starting = null
      })
    }
    return this.starting
  }

  private async open(stream?: MediaStream) {
    const generation = this.generation
    const Context = audioContextConstructor()
    if (!Context) throw new Error('Przeglądarka nie obsługuje nagrywania dźwięku.')
    const media =
      stream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }))
    const ownsStream = !stream
    const release = (context?: AudioContext) => {
      if (ownsStream) media.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => {})
    }
    if (generation !== this.generation) return release()

    const context = new Context()
    try {
      const sampleRate = Math.min(TARGET_SAMPLE_RATE, context.sampleRate)
      const source = context.createMediaStreamSource(media)
      const node = await this.captureNode(context)
      if (generation !== this.generation) {
        this.detachNode?.()
        this.detachNode = null
        return release(context)
      }
      const sink = context.createGain()
      sink.gain.value = 0 // węzeł musi być podłączony do wyjścia, ale nic nie odtwarzamy
      source.connect(node)
      node.connect(sink)
      sink.connect(context.destination)
      this.sampleRate = sampleRate
      this.resampler = createResampler(context.sampleRate, sampleRate)
      this.ring = new PcmRing(sampleRate * BUFFER_SECONDS)
      this.context = context
      this.source = source
      this.node = node
      this.sink = sink
      this.stream = media
      this.ownsStream = ownsStream
    } catch (error) {
      this.detachNode?.()
      this.detachNode = null
      release(context)
      throw error
    }
    await this.resume()
  }

  private async captureNode(context: AudioContext): Promise<AudioNode> {
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
      try {
        await context.audioWorklet.addModule(url)
        const node = new AudioWorkletNode(context, WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit',
        })
        node.port.onmessage = (event: MessageEvent<Float32Array>) => this.push(event.data)
        this.detachNode = () => {
          node.port.onmessage = null
        }
        return node
      } catch {
        /* brak AudioWorklet (stare przeglądarki, blokada blob:) → ScriptProcessor */
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    const processor = context.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => this.push(event.inputBuffer.getChannelData(0))
    this.detachNode = () => {
      processor.onaudioprocess = null
    }
    return processor
  }

  /** AudioContext bywa wstrzymany do pierwszego gestu użytkownika — wtedy wznawiamy przy kliknięciu. */
  private async resume() {
    const context = this.context
    if (!context || context.state !== 'suspended') return
    await context.resume().catch(() => {})
    if (context.state !== 'suspended' || typeof window === 'undefined' || this.context !== context) return
    const unlock = () => {
      void context.resume().catch(() => {})
      this.removeUnlock()
    }
    this.unlock = unlock
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  private removeUnlock() {
    if (!this.unlock || typeof window === 'undefined') return
    window.removeEventListener('pointerdown', this.unlock)
    window.removeEventListener('keydown', this.unlock)
    this.unlock = null
  }

  private push(chunk: Float32Array) {
    if (!this.resampler || !this.ring) return
    this.ring.write(this.resampler.push(chunk))
  }

  /** Zatrzymuje nagrywanie i zwalnia mikrofon (także w trakcie startu). Bufor zostaje do odczytu. */
  stop() {
    this.generation++
    this.removeUnlock()
    this.detachNode?.()
    this.detachNode = null
    try {
      this.source?.disconnect()
      this.node?.disconnect()
      this.sink?.disconnect()
    } catch {
      /* już rozłączone */
    }
    if (this.ownsStream) this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close().catch(() => {})
    this.context = null
    this.source = null
    this.node = null
    this.sink = null
    this.stream = null
    this.ownsStream = false
  }

  /** Czas nagrania w ms (liczony z próbek, więc zgodny z `slice`). */
  now(): number {
    return this.ring ? (this.ring.written / this.sampleRate) * 1000 : 0
  }

  /** Próbki z przedziału czasu nagrania [fromMs, toMs). */
  slice(fromMs: number, toMs: number): Float32Array {
    if (!this.ring) return new Float32Array(0)
    return this.ring.slice((fromMs / 1000) * this.sampleRate, (toMs / 1000) * this.sampleRate)
  }
}

/** Pauza (np. „ogon” nagrania po kliknięciu stop). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
