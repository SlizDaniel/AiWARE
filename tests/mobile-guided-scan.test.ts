import { describe, expect, it } from 'vitest'
import { GuidedScan, JUNCTION_PREFIX, savedJunctions } from '../mobile/src/lib/guidedScan'
import { canvasGeometry } from '../mobile/src/lib/mapping'
import type { MapPath } from '../mobile/src/lib/contracts'
import { parseMapPathInput } from '../src/server/mapPaths'

const start = { x: 0, y: 0, label: 'START' }
function walk(scan: GuidedScan, count: number) {
  for (let i = 0; i < count; i++) scan.step(i * 600)
}
function expectOrthogonal(scan: GuidedScan) {
  const { points } = scan.snapshot()
  for (let i = 1; i < points.length; i++) {
    expect(Math.min(Math.abs(points[i]!.x - points[i - 1]!.x), Math.abs(points[i]!.y - points[i - 1]!.y))).toBeLessThan(1e-6)
  }
}

describe('guided warehouse scan', () => {
  it('draws straight aisles, explicit turns and a shared junction when turning in place', () => {
    const scan = new GuidedScan(0.7, start, 0)
    walk(scan, 10)
    const junction = scan.addJunction()
    expect(junction.label).toBe('S1')
    scan.turn('right')
    walk(scan, 5)
    expect(scan.steps).toBe(15)
    expect(scan.snapshot().points).toHaveLength(3)
    expect(scan.snapshot().points[2]!.x).toBeCloseTo(3.5)
    expect(scan.snapshot().points[2]!.y).toBeCloseTo(7)
    expect(scan.allJunctions()).toHaveLength(2)
    expectOrthogonal(scan)
  })

  it('closes an uneven rectangular loop exactly and moves its new junctions with the correction', () => {
    const scan = new GuidedScan(1, start, 0)
    walk(scan, 10); scan.turn('right')
    walk(scan, 10); scan.turn('right')
    walk(scan, 9); scan.turn('right')
    walk(scan, 9)
    expect(scan.returnTo(start)).toBeCloseTo(Math.sqrt(2))
    expect(scan.snapshot().points.at(-1)).toMatchObject({ x: 0, y: 0 })
    expectOrthogonal(scan)
    const junction = scan.allJunctions().find(item => item.label === 'S1')!
    expect(junction.y).toBeCloseTo(scan.snapshot().points[1]!.y)
    expect(scan.steps).toBe(38)
  })

  it('keeps a newly marked destination and the preceding path fixed when revisiting it', () => {
    const scan = new GuidedScan(1, start, 0)
    walk(scan, 4)
    const junction = scan.addJunction()
    scan.turn('right'); walk(scan, 5)
    scan.turn('right'); walk(scan, 4)
    scan.turn('right'); walk(scan, 4)
    scan.turn('right'); walk(scan, 3)
    scan.returnTo(junction)
    expect(scan.snapshot().points[1]).toMatchObject({ x: 0, y: 4 })
    expect(scan.snapshot().points.at(-1)).toMatchObject({ x: 0, y: 4 })
    expect(scan.allJunctions().find(item => item.label === junction.label)).toEqual(junction)
    expectOrthogonal(scan)
  })

  it('keeps confirmed geometry fixed during a subsequent loop correction', () => {
    const scan = new GuidedScan(1, start, 0)
    walk(scan, 5)
    const junction = scan.addJunction()
    scan.returnTo(junction)
    const prefix = scan.snapshot().points
    scan.turn('right'); walk(scan, 5)
    scan.turn('right'); walk(scan, 5)
    scan.turn('right'); walk(scan, 4)
    scan.turn('right'); walk(scan, 4)
    scan.returnTo(junction)
    expect(scan.snapshot().points.slice(0, prefix.length)).toEqual(prefix)
    expectOrthogonal(scan)
  })

  it('rejects impossible anchors without partially changing the scan', () => {
    const scan = new GuidedScan(1, start, 0)
    walk(scan, 10)
    const before = scan.snapshot()
    expect(() => scan.returnTo({ x: 4, y: 10, label: 'bad' })).toThrow('korekta byłaby zbyt duża')
    expect(() => scan.returnTo(start)).toThrow()
    expect(scan.snapshot()).toEqual(before)
    scan.turn('left'); walk(scan, 2)
    expect(scan.snapshot().points.at(-1)).toMatchObject({ x: -2, y: 10 })
  })

  it('resumes from a saved junction, allocates new labels and fits both traversals on one map', () => {
    const first = new GuidedScan(1, start, 0)
    walk(first, 5); first.turn('right'); walk(first, 4)
    const input = parseMapPathInput({ name: 'Alejki', step_length: 1, ...first.snapshot() })
    const path: MapPath = { ...input, id: 1, actor: 'demo', created: '' }
    const known = savedJunctions([path])
    const junction = known.find(item => item.label === 'S1')!
    const second = new GuidedScan(1, junction, 270, known)
    walk(second, 3)
    expect(second.addJunction().label).toBe('S2')
    const path2: MapPath = { ...path, ...second.snapshot(), id: 2 }
    expect(path2.points[0]).toMatchObject({ x: 0, y: 5 })
    const geometry = canvasGeometry([path2, path], [])
    expect(geometry.start).toEqual((() => { const p = geometry.proj.toSvg(start); return { left: p.x, top: p.y } })())
    expect(geometry.markers.filter(marker => marker.label === 'S1')).toHaveLength(1)
    expect(geometry.markers.some(marker => marker.label.startsWith(JUNCTION_PREFIX))).toBe(false)
  })

  it('validates calibration and returns independent snapshots', () => {
    expect(() => new GuidedScan(NaN, start, 0)).toThrow()
    expect(() => new GuidedScan(2, start, 0)).toThrow()
    const scan = new GuidedScan(1, start, 90)
    walk(scan, 3)
    const copy = scan.snapshot()
    copy.points[0]!.x = 100
    expect(scan.snapshot().points[0]!.x).toBe(0)
  })
})
