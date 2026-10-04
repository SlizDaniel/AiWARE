// Testy PDR: syntetyczny sygnał akcelerometru → kroki, kroki+kompas → metry,
// projekcja na SVG (północ u góry, siatka 1-2-5).
import { describe, expect, it } from 'vitest'
import {
  PathTracker,
  StepDetector,
  boundsOf,
  circularMean,
  formatMeters,
  magnitude,
  pathDistanceM,
  projectionFor,
} from './pdr'

/** Sygnał „spacer”: seria impulsów (pół sinusa w górę, pół w dół) co `periodMs`. */
function walkSignal(steps: number, periodMs = 800, peak = 3.2, sampleHz = 50): { mag: number; t: number }[] {
  const samples: { mag: number; t: number }[] = []
  const dt = 1000 / sampleHz
  const half = periodMs / 2
  for (let step = 0; step < steps; step++) {
    const base = step * periodMs
    for (let t = 0; t < periodMs; t += dt) {
      const phase = t / half
      // spoczynek → uderzenie piętą (szczyt) → spoczynek
      const bump = phase <= 1 ? Math.sin(phase * Math.PI) : 0
      samples.push({ mag: 9.81 + bump * peak, t: base + t })
    }
  }
  return samples
}

describe('magnitude', () => {
  it('liczy długość wektora (grawitacja na jednej osi)', () => {
    expect(magnitude({ x: 0, y: 0, z: 9.81 })).toBeCloseTo(9.81)
    expect(magnitude({ x: 3, y: 4, z: 0 })).toBe(5)
  })
})

describe('StepDetector', () => {
  it('liczy kroki w sygnału spaceru (impuls co 800 ms → jeden krok na impuls)', () => {
    const detector = new StepDetector()
    let steps = 0
    for (const { mag, t } of walkSignal(10)) {
      if (detector.push(mag, t)) steps++
    }
    expect(steps).toBe(10)
  })

  it('nie liczy kroków, gdy telefon leży spokojnie (szum)', () => {
    const detector = new StepDetector()
    let steps = 0
    for (let t = 0; t < 10_000; t += 20) {
      const noise = 0.15 * Math.sin(t / 173)
      if (detector.push(9.81 + noise, t)) steps++
    }
    expect(steps).toBe(0)
  })

  it('ignoruje obracanie telefonu (|a| stałe, zmienia się tylko kierunek)', () => {
    const detector = new StepDetector()
    let steps = 0
    for (let t = 0; t < 5_000; t += 33) {
      if (detector.push(9.81, t)) steps++
    }
    expect(steps).toBe(0)
  })

  it('reset zaczyna liczenie od nowa', () => {
    const detector = new StepDetector()
    for (const { mag, t } of walkSignal(3)) detector.push(mag, t)
    detector.reset()
    let steps = 0
    for (const { mag, t } of walkSignal(4).map((s) => ({ mag: s.mag, t: s.t + 5_000 }))) {
      if (detector.push(mag, t)) steps++
    }
    expect(steps).toBe(4)
  })
})

describe('circularMean', () => {
  it('przechodzi przez zawinięcie 350°/10° → 0°', () => {
    expect(circularMean([350, 10])).toBeCloseTo(0)
  })
  it('zwykła średnia kierunków', () => {
    expect(circularMean([0, 90])).toBeCloseTo(45)
  })
  it('puste wejście → 0', () => {
    expect(circularMean([])).toBe(0)
  })
})

describe('PathTracker', () => {
  it('krok na wschód (kompas 90°) rośnie po x', () => {
    const tracker = new PathTracker(0.7)
    tracker.setHeading(90)
    tracker.step(100)
    tracker.step(400)
    tracker.step(700)
    const pos = tracker.position()
    expect(pos.x).toBeCloseTo(2.1)
    expect(pos.y).toBeCloseTo(0)
  })

  it('krok na północ (0°) rośnie po y', () => {
    const tracker = new PathTracker(0.5)
    tracker.setHeading(0)
    tracker.step(0)
    tracker.step(500)
    expect(tracker.position().y).toBeCloseTo(1.0)
    expect(tracker.position().x).toBeCloseTo(0)
  })

  it('obchód prostokąta wraca na start', () => {
    const tracker = new PathTracker(1)
    for (const [heading, steps] of [
      [0, 3],
      [90, 3],
      [180, 3],
      [270, 3],
    ] as const) {
      tracker.setHeading(heading)
      for (let i = 0; i < steps; i++) tracker.step(i * 500)
    }
    expect(tracker.position().x).toBeCloseTo(0)
    expect(tracker.position().y).toBeCloseTo(0)
    expect(tracker.allPoints().length).toBe(13) // start + 12 kroków
  })

  it('znacznik ląduje na bieżącej pozycji i pamięta strefę', () => {
    const tracker = new PathTracker(0.7)
    tracker.setHeading(90)
    tracker.step(0)
    const marker = tracker.addMarker('A-01', 'kartony')
    expect(marker.x).toBeCloseTo(0.7)
    expect(marker.zone).toBe('kartony')
    expect(tracker.allMarkers().length).toBe(1)
  })

  it('odrzuca nierealistyczną długość kroku', () => {
    const tracker = new PathTracker()
    tracker.setStepLength(99)
    expect(tracker.stepLength).toBe(0.7)
    tracker.setStepLength(0.6)
    expect(tracker.stepLength).toBe(0.6)
  })
})

describe('pathDistanceM', () => {
  it('suma odcinków', () => {
    expect(pathDistanceM([
      { x: 0, y: 0, t: 0 },
      { x: 3, y: 0, t: 1 },
      { x: 3, y: 4, t: 2 },
    ])).toBeCloseTo(7)
  })
})

describe('boundsOf i projectionFor', () => {
  it('puste wejście → jednostkowy prostokąt', () => {
    const bounds = boundsOf([])
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
  })

  it('degenerowany prostokąt (linia) dostaje margines', () => {
    const bounds = boundsOf([{ points: [{ x: 2, y: 5, t: 0 }, { x: 2, y: 5, t: 1 }] }])
    expect(bounds.minX).toBeLessThan(2)
    expect(bounds.maxX).toBeGreaterThan(2)
  })

  it('projekcja: północ u góry (y odwrócone) i proporcje zachowane', () => {
    const bounds = boundsOf([
      { points: [{ x: 0, y: 0, t: 0 }, { x: 4, y: 0, t: 1 }, { x: 4, y: 2, t: 2 }] },
    ])
    const proj = projectionFor(bounds, 500, 300)
    expect(proj.scale).toBeCloseTo(452 / 4) // ogranicza szerokość (4 m na 500 px)
    const northEast = proj.toSvg({ x: 4, y: 2 })
    const southEast = proj.toSvg({ x: 4, y: 0 })
    expect(northEast.y).toBeLessThan(southEast.y)
    const back = proj.fromSvg(northEast.x, northEast.y)
    expect(back.x).toBeCloseTo(4)
    expect(back.y).toBeCloseTo(2)
  })

  it('siatka 1-2-5: kratka nigdy mniejsza niż ~64 px', () => {
    const proj = projectionFor({ minX: 0, minY: 0, maxX: 100, maxY: 60 }, 800, 500)
    expect(proj.gridStepM * proj.scale).toBeGreaterThanOrEqual(64)
    expect([0.5, 1, 2, 5, 10, 20, 50, 100]).toContain(proj.gridStepM)
  })
})

describe('formatMeters', () => {
  it('formatuje po polsku', () => {
    expect(formatMeters(16.44)).toMatch(/16,4 m/)
  })
})
