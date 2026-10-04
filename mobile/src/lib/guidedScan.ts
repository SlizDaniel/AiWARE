import type { PathMarker, PathPoint } from '../../../src/lib/pdr'

// Existing marker payload preserves junctions without changing the API/schema.
export const JUNCTION_PREFIX = 'Skrzyżowanie: '
export type Junction = { x: number; y: number; label: string }
export type ScanDirection = 0 | 90 | 180 | 270
export const SCAN_DIRECTIONS: { value: ScanDirection; label: string }[] = [
  { value: 0, label: '↑ Góra' }, { value: 90, label: '→ Prawo' },
  { value: 180, label: '↓ Dół' }, { value: 270, label: '← Lewo' },
]

export function savedJunctions(paths: { markers: PathMarker[] }[]): Junction[] {
  const byLabel = new Map<string, Junction>()
  for (const path of paths) for (const marker of path.markers) {
    if (!marker.label.startsWith(JUNCTION_PREFIX)) continue
    const label = marker.label.slice(JUNCTION_PREFIX.length)
    if (!byLabel.has(label)) byLabel.set(label, { x: marker.x, y: marker.y, label })
  }
  return [...byLabel.values()]
}

/** Straight aisle segments, explicit turns, and user-confirmed loop closure. */
export class GuidedScan {
  private points: PathPoint[]
  private junctions: { junction: Junction; index: number }[]
  private boundary = true
  private fixedIndex = 0
  private stepCount = 0
  private direction: ScanDirection

  constructor(readonly stepLength: number, start: Junction, direction: ScanDirection, private readonly known: Junction[] = []) {
    if (!Number.isFinite(stepLength) || stepLength < 0.3 || stepLength > 1.5) throw new Error('Długość kroku musi wynosić 0,3–1,5 m.')
    this.points = [{ x: start.x, y: start.y, t: 0 }]
    this.junctions = [{ junction: { ...start }, index: 0 }]
    this.direction = direction
  }

  get heading(): ScanDirection { return this.direction }
  get steps(): number { return this.stepCount }

  step(t: number): void {
    const last = this.points[this.points.length - 1]!
    const dx = this.direction === 90 ? this.stepLength : this.direction === 270 ? -this.stepLength : 0
    const dy = this.direction === 0 ? this.stepLength : this.direction === 180 ? -this.stepLength : 0
    const next = { x: last.x + dx, y: last.y + dy, t: Math.max(0, t) }
    if (this.boundary) this.points.push(next)
    else this.points[this.points.length - 1] = next
    this.boundary = false
    this.stepCount++
  }

  turn(side: 'left' | 'right' | 'back'): void {
    this.addJunction()
    this.direction = ((this.direction + (side === 'left' ? 270 : side === 'right' ? 90 : 180)) % 360) as ScanDirection
  }

  addJunction(): Junction {
    const index = this.points.length - 1
    const existing = this.junctions.find(item => item.index === index)
    this.boundary = true
    if (existing) return { ...existing.junction }
    const used = new Set([...this.known, ...this.junctions.map(item => item.junction)].map(item => item.label))
    let number = 1
    while (used.has(`S${number}`)) number++
    const point = this.points[index]!
    const junction = { x: point.x, y: point.y, label: `S${number}` }
    this.junctions.push({ junction, index })
    return { ...junction }
  }

  /** Correct only the unanchored span; distribute error along each axis separately. */
  returnTo(target: Junction): number {
    const previousVisit = this.junctions.find(item => item.junction.label === target.label)
    const anchorIndex = Math.max(this.fixedIndex, previousVisit?.index ?? 0)
    const last = this.points[this.points.length - 1]!
    const error = { x: target.x - last.x, y: target.y - last.y }
    const length = { x: 0, y: 0 }
    for (let i = anchorIndex + 1; i < this.points.length; i++) {
      length.x += Math.abs(this.points[i]!.x - this.points[i - 1]!.x)
      length.y += Math.abs(this.points[i]!.y - this.points[i - 1]!.y)
    }
    for (const axis of ['x', 'y'] as const) {
      if (Math.abs(error[axis]) < 1e-6) continue
      if (length[axis] < 1e-6 || Math.abs(error[axis]) > length[axis] * 0.5) {
        throw new Error('Ten punkt nie pasuje do przejścia. Sprawdź skręty i wybrane skrzyżowanie — korekta byłaby zbyt duża.')
      }
    }
    const corrected = this.points.map(point => ({ ...point }))
    for (let i = anchorIndex + 1; i < corrected.length; i++) {
      for (const axis of ['x', 'y'] as const) {
        const delta = this.points[i]![axis] - this.points[i - 1]![axis]
        corrected[i]![axis] = corrected[i - 1]![axis] + delta + (length[axis] > 0 ? error[axis] * Math.abs(delta) / length[axis] : 0)
      }
    }
    corrected[corrected.length - 1] = { x: target.x, y: target.y, t: last.t }
    this.points = corrected
    for (const item of this.junctions) {
      if (item.index > anchorIndex) {
        const point = corrected[item.index]!
        item.junction = { ...item.junction, x: point.x, y: point.y }
      }
    }
    // The destination is a previously known physical place, not a new junction.
    const index = corrected.length - 1
    this.junctions = this.junctions.filter(item => item.index !== index || index === 0)
    if (index !== 0) this.junctions.push({ junction: { ...target }, index })
    this.fixedIndex = index
    this.boundary = true
    return Math.hypot(error.x, error.y)
  }

  allJunctions(): Junction[] {
    const result = new Map(this.known.map(item => [item.label, { ...item }]))
    for (const item of this.junctions) result.set(item.junction.label, { ...item.junction })
    return [...result.values()]
  }

  snapshot(): { points: PathPoint[]; markers: PathMarker[] } {
    const markers = new Map<string, PathMarker>()
    for (const { junction } of this.junctions) markers.set(junction.label, { x: junction.x, y: junction.y, label: JUNCTION_PREFIX + junction.label })
    return { points: this.points.map(point => ({ ...point })), markers: [...markers.values()] }
  }
}
