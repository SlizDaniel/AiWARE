// PDR (pedestrian dead reckoning) — czysta matematyka mapowania hali telefonem:
// akcelerometr → detekcja kroków, kompas → kierunek, krok × kierunek → metry.
// Bez dostępu do czujników przeglądarki (glue: pdrSensors.ts) — testowalne na sucho.

export type Vec3 = { x: number; y: number; z: number }

/** Punkt ścieżki w metrach od startu (x = wschód, y = północ), t = czas [ms]. */
export type PathPoint = { x: number; y: number; t: number }

/** Znacznik miejsca odłożonego podczas spaceru (np. „A-01”, opcjonalnie strefa). */
export type PathMarker = { x: number; y: number; label: string; zone?: string }

export function magnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

// ------------------------------------------------------------- detekcja kroków

/**
 * Wykrywa kroki w sygnale |a| z akcelerometru. Grawitacja jest estymowana
 * filtrem EMA (stała czasowa tauMs), a szczyty high-pass powyżej progu
 * wejścia potwierdzane po powrocie poniżej progu wyjścia — jeden cykl = krok.
 * Refrakcja (minIntervalMs) odcina drgania odbicia po uderzeniu piętą.
 */
export class StepDetector {
  private gravity = 9.81
  private armed = false
  private peak = 0
  private peakAt = 0
  private lastStepAt = -Infinity
  private lastAt: number | null = null

  constructor(
    private readonly enter = 1.5,
    private readonly exit = 0.6,
    private readonly minPeak = 1.2,
    private readonly minIntervalMs = 250,
    private readonly tauMs = 600,
  ) {}

  reset(): void {
    this.gravity = 9.81
    this.armed = false
    this.peak = 0
    this.peakAt = 0
    this.lastStepAt = -Infinity
    this.lastAt = null
  }

  /** Nowa próbka |a| [m/s²] w czasie tMs; true = potwierdzony krok. */
  push(mag: number, tMs: number): boolean {
    const dt = this.lastAt === null ? 0 : Math.max(0, tMs - this.lastAt)
    this.lastAt = tMs
    const alpha = dt > 0 ? Math.exp(-dt / this.tauMs) : 0
    this.gravity += (1 - alpha) * (mag - this.gravity)
    const high = mag - this.gravity

    if (!this.armed) {
      if (high >= this.enter) {
        this.armed = true
        this.peak = high
        this.peakAt = tMs
      }
      return false
    }
    if (high > this.peak) {
      this.peak = high
      this.peakAt = tMs
    }
    if (high > this.exit && tMs - this.peakAt < 400) return false
    this.armed = false
    if (this.peak < this.minPeak) return false
    if (tMs - this.lastStepAt < this.minIntervalMs) return false
    this.lastStepAt = this.peakAt
    return true
  }
}

/** Średnia kątowa stopni (0°/360° przechodzi przez zawinięcie). */
export function circularMean(degrees: number[]): number {
  if (degrees.length === 0) return 0
  let sin = 0
  let cos = 0
  for (const deg of degrees) {
    const rad = (deg * Math.PI) / 180
    sin += Math.sin(rad)
    cos += Math.cos(rad)
  }
  const mean = (Math.atan2(sin, cos) * 180) / Math.PI
  return (mean + 360) % 360
}

// ------------------------------------------------------- ścieżka z kroków

const DEFAULT_STEP_LENGTH_M = 0.7

/**
 * Składa ścieżkę z kroków: każdy krok przesuwa pozycję o stepLengthM
 * w aktualnym kierunku. Start w (0, 0), kierunek 0° = północ.
 */
export class PathTracker {
  private readonly points: PathPoint[] = [{ x: 0, y: 0, t: 0 }]
  private readonly markers: PathMarker[] = []
  private headingDeg = 0

  constructor(private stepLengthM = DEFAULT_STEP_LENGTH_M) {}

  get stepLength(): number {
    return this.stepLengthM
  }

  setStepLength(meters: number): void {
    if (Number.isFinite(meters) && meters > 0.1 && meters < 2) this.stepLengthM = meters
  }

  /** Kompas w stopniach: 0 = północ, 90 = wschód (spójnie z telefonem na płasko). */
  setHeading(deg: number): void {
    if (Number.isFinite(deg)) this.headingDeg = ((deg % 360) + 360) % 360
  }

  get heading(): number {
    return this.headingDeg
  }

  /** Jeden krok do przodu; zwraca nowy punkt ścieżki. */
  step(tMs: number): PathPoint {
    const last = this.points[this.points.length - 1]
    const rad = (this.headingDeg * Math.PI) / 180
    const point: PathPoint = {
      x: last.x + this.stepLengthM * Math.sin(rad),
      y: last.y + this.stepLengthM * Math.cos(rad),
      t: tMs,
    }
    this.points.push(point)
    return point
  }

  addMarker(label: string, zone?: string): PathMarker {
    const last = this.points[this.points.length - 1]
    const marker: PathMarker = { x: last.x, y: last.y, label }
    if (zone) marker.zone = zone
    this.markers.push(marker)
    return marker
  }

  position(): PathPoint {
    return this.points[this.points.length - 1]
  }

  allPoints(): PathPoint[] {
    return [...this.points]
  }

  allMarkers(): PathMarker[] {
    return [...this.markers]
  }
}

export function pathDistanceM(points: PathPoint[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return sum
}

// ----------------------------------------------------------- projekcja na SVG

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

const GRID_STEPS_M = [0.5, 1, 2, 5, 10, 20, 50, 100]

/** Wspólny prostokąt wszystkich ścieżek i znaczników; puste wejście → 1×1 m. */
export function boundsOf(shapes: { points: PathPoint[]; markers?: PathMarker[] }[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const shape of shapes) {
    for (const point of shape.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    for (const marker of shape.markers ?? []) {
      minX = Math.min(minX, marker.x)
      minY = Math.min(minY, marker.y)
      maxX = Math.max(maxX, marker.x)
      maxY = Math.max(maxY, marker.y)
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  if (minX === maxX) {
    minX -= 0.5
    maxX += 0.5
  }
  if (minY === maxY) {
    minY -= 0.5
    maxY += 0.5
  }
  return { minX, minY, maxX, maxY }
}

export type Projection = {
  scale: number
  gridStepM: number
  toSvg: (point: { x: number; y: number }) => { x: number; y: number }
  fromSvg: (x: number, y: number) => { x: number; y: number }
}

/**
 * Skaluje metry na piksele zachowując proporcje (północ u góry — oś y odwrócona).
 * Siatka wybierana z 1-2-5 tak, by kratka miała co najmniej ~64 px.
 */
export function projectionFor(bounds: Bounds, width: number, height: number, padPx = 24): Projection {
  const spanX = Math.max(0.1, bounds.maxX - bounds.minX)
  const spanY = Math.max(0.1, bounds.maxY - bounds.minY)
  const scale = Math.min((width - 2 * padPx) / spanX, (height - 2 * padPx) / spanY)
  const gridStepM = GRID_STEPS_M.find((step) => step * scale >= 64) ?? GRID_STEPS_M[GRID_STEPS_M.length - 1]
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2
  const toSvg = (point: { x: number; y: number }) => ({
    x: width / 2 + (point.x - midX) * scale,
    y: height / 2 - (point.y - midY) * scale,
  })
  const fromSvg = (x: number, y: number) => ({
    x: midX + (x - width / 2) / scale,
    y: midY - (y - height / 2) / scale,
  })
  return { scale, gridStepM, toSvg, fromSvg }
}

/** Metry na czytelny opis: 16.4 → „16,4 m”. */
export function formatMeters(meters: number): string {
  return `${meters.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} m`
}
