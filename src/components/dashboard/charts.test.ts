import { expect, test } from 'vitest'
import { buildStepSeries, labelStep, niceMax, valueDomain, type TrendPoint } from './charts'

const H = 3_600_000
const start = Date.parse('2026-10-03T00:00:00Z')
const end = start + 24 * H

function point(audit_id: number, hour: number, before: number, after: number, continuous = true, extra: Partial<TrendPoint> = {}): TrendPoint {
  return {
    audit_id,
    ts: new Date(start + hour * H).toISOString(),
    event_type: 'stock_change',
    before,
    after,
    delta: after - before,
    undo_of: null,
    undone_by: null,
    continuous,
    ...extra,
  }
}

test('step line from the known opening through each change to the end of the range', () => {
  const { segments, gaps } = buildStepSeries([point(1, 2, 13, 11), point(2, 5, 11, 30)], 13, start, end)
  expect(gaps).toEqual([])
  expect(segments).toEqual([
    [
      { t: start, v: 13 },
      { t: start + 2 * H, v: 13 },
      { t: start + 2 * H, v: 11 },
      { t: start + 5 * H, v: 11 },
      { t: start + 5 * H, v: 30 },
      { t: end, v: 30 },
    ],
  ])
})

test('without a known opening the line starts at the first change (no invented start)', () => {
  const { segments } = buildStepSeries([point(1, 4, 10, 8)], null, start, end)
  expect(segments).toEqual([
    [
      { t: start + 4 * H, v: 10 },
      { t: start + 4 * H, v: 8 },
      { t: end, v: 8 },
    ],
  ])
})

test('continuous=false breaks the line and records the gap', () => {
  const { segments, gaps } = buildStepSeries([point(1, 1, 20, 18), point(2, 3, 25, 24, false)], 20, start, end)
  expect(segments).toHaveLength(2)
  expect(segments[0].at(-1)).toEqual({ t: start + 3 * H, v: 18 })
  expect(segments[1][0]).toEqual({ t: start + 3 * H, v: 25 })
  expect(gaps).toEqual([{ t: start + 3 * H, from: 18, to: 25, auditId: 2 }])
})

test('points are sorted by time then audit id and clamped to the range; undo stays on the chart', () => {
  const undo = point(9, 6, 11, 13, true, { undo_of: 1 })
  const { segments } = buildStepSeries([undo, point(1, 2, 13, 11, true, { undone_by: 9 }), point(10, 30, 13, 12)], 13, start, end)
  const values = segments[0].map((vertex) => vertex.v)
  expect(values).toEqual([13, 13, 11, 11, 13, 13, 12, 12])
  expect(segments[0].at(-2)?.t).toBe(end)
})

test('empty history with a known opening is a flat line; without it nothing is drawn', () => {
  expect(buildStepSeries([], 5, start, end).segments).toEqual([[{ t: start, v: 5 }, { t: end, v: 5 }]])
  expect(buildStepSeries([], null, start, end).segments).toEqual([])
})

test('axis helpers', () => {
  expect(niceMax(0)).toBe(1)
  expect(niceMax(3)).toBe(5)
  expect(niceMax(12)).toBe(20)
  expect(niceMax(57)).toBe(100)
  expect(labelStep(7, 8)).toBe(1)
  expect(labelStep(30, 8)).toBe(4)
  expect(valueDomain([13, 11, 30, 12])).toEqual({ min: 0, max: 50 })
  expect(valueDomain([-3, 4])).toEqual({ min: -5, max: 5 })
})
