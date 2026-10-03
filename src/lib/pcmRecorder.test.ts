import { describe, expect, test } from 'vitest'
import { BUFFER_SECONDS, createResampler, downsample, encodeWav, PcmRecorder, PcmRing, TARGET_SAMPLE_RATE, wavBlob } from './pcmRecorder'

function ramp(length: number, start = 0): Float32Array {
  return Float32Array.from({ length }, (_, index) => start + index)
}

describe('downsample', () => {
  test('48 kHz → 16 kHz averages every three samples', () => {
    const out = downsample(Float32Array.from([1, 2, 3, 4, 5, 6, 0.3, 0.3, 0.3]), 48_000, 16_000)
    expect(Array.from(out)).toEqual([2, 5, expect.closeTo(0.3, 6)])
  })

  test('one second keeps its duration for common device rates', () => {
    expect(downsample(new Float32Array(48_000), 48_000, 16_000).length).toBe(16_000)
    expect(downsample(new Float32Array(44_100), 44_100, 16_000).length).toBe(16_000)
    expect(downsample(new Float32Array(22_050), 22_050, 16_000).length).toBe(16_000)
  })

  test('a constant signal stays constant (no gain change)', () => {
    const out = downsample(new Float32Array(4410).fill(0.25), 44_100, 16_000)
    expect(out.every((value) => Math.abs(value - 0.25) < 1e-6)).toBe(true)
  })

  test('no upsampling: equal or lower source rate passes samples through', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3])
    expect(Array.from(downsample(input, 16_000, 16_000))).toEqual(Array.from(input))
    expect(Array.from(downsample(input, 8_000, 16_000))).toEqual(Array.from(input))
  })

  test('streaming in odd-sized chunks gives the same result as one pass', () => {
    const input = ramp(44_100)
    const whole = downsample(input, 44_100, 16_000)
    const resampler = createResampler(44_100, 16_000)
    const parts: number[] = []
    for (let offset = 0; offset < input.length; offset += 128) parts.push(...resampler.push(input.subarray(offset, offset + 128)))
    expect(parts.length).toBe(whole.length)
    expect(parts.every((value, index) => Math.abs(value - whole[index]) < 1e-3)).toBe(true)
  })
})

describe('encodeWav', () => {
  test('writes a 16-bit PCM mono RIFF header', () => {
    const bytes = encodeWav(Float32Array.from([0, 1, -1, 0.5, 2]), 16_000)
    const view = new DataView(bytes.buffer)
    const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
    expect(bytes.length).toBe(44 + 5 * 2)
    expect(text(0)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 10)
    expect(text(8)).toBe('WAVE')
    expect(text(12)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(text(36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(10)
    // próbki: 0, max, min, połowa, przycięte do max
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + index * 2, true))).toEqual([0, 32767, -32768, 16383, 32767])
  })

  test('30 s at 16 kHz stays under 1 MB', () => {
    const bytes = encodeWav(new Float32Array(TARGET_SAMPLE_RATE * BUFFER_SECONDS), TARGET_SAMPLE_RATE)
    expect(bytes.length).toBeLessThan(1024 * 1024)
  })

  test('wavBlob is typed audio/wav', () => {
    const blob = wavBlob(new Float32Array(16), 16_000)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 32)
  })
})

describe('PcmRing', () => {
  test('keeps only the last capacity samples, indexed from the start of recording', () => {
    const ring = new PcmRing(5)
    ring.write(ramp(3))
    ring.write(ramp(4, 3))
    expect(ring.written).toBe(7)
    expect(Array.from(ring.slice(0, 7))).toEqual([2, 3, 4, 5, 6])
    expect(Array.from(ring.slice(3, 5))).toEqual([3, 4])
    expect(Array.from(ring.slice(5, 100))).toEqual([5, 6])
    expect(ring.slice(6, 6).length).toBe(0)
  })

  test('a chunk larger than the buffer keeps its tail', () => {
    const ring = new PcmRing(4)
    ring.write(ramp(10))
    expect(ring.written).toBe(10)
    expect(Array.from(ring.slice(0, 10))).toEqual([6, 7, 8, 9])
  })
})

describe('PcmRecorder before start', () => {
  test('is idle with an empty clock and buffer', () => {
    const recorder = new PcmRecorder()
    expect(recorder.isRunning).toBe(false)
    expect(recorder.now()).toBe(0)
    expect(recorder.slice(0, 1000).length).toBe(0)
    expect(() => recorder.stop()).not.toThrow()
  })

  test('start fails cleanly without Web Audio', async () => {
    await expect(new PcmRecorder().start()).rejects.toThrow()
  })
})
