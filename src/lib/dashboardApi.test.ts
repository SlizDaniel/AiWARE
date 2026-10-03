import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  activityParams,
  addDays,
  customRangeError,
  DEFAULT_FILTERS,
  eventLabel,
  exportActivityCsv,
  fetchActivity,
  fetchDashboard,
  fetchShift,
  fetchTrend,
  formatDay,
  isoToZonedInput,
  periodParams,
  shiftWindow,
  zonedDayStart,
  zonedInputToIso,
} from './dashboardApi'

const WARSAW = 'Europe/Warsaw'

describe('query parameters', () => {
  test('preset and custom periods are never mixed', () => {
    expect(periodParams({ kind: 'preset', period: '30d' }).toString()).toBe('period=30d')
    expect(periodParams({ kind: 'custom', from: '2026-10-01', to: '2026-10-03' }).toString()).toBe('from=2026-10-01&to=2026-10-03')
  })

  test('activity filters are AND-ed, empty ones omitted, paging only when asked', () => {
    const filters = { actorId: 'unassigned', eventType: 'stock_change', itemId: '7', q: '  kartony ', status: 'undone' as const }
    expect(Object.fromEntries(activityParams({ kind: 'preset', period: '7d' }, filters, { page: 2, pageSize: 25 }))).toEqual({
      period: '7d',
      actor_id: 'unassigned',
      event_type: 'stock_change',
      item_id: '7',
      q: 'kartony',
      status: 'undone',
      page: '2',
      page_size: '25',
    })
    const exportParams = activityParams({ kind: 'preset', period: 'today' }, DEFAULT_FILTERS)
    expect(exportParams.toString()).toBe('period=today&status=all')
    expect(exportParams.has('page')).toBe(false)
  })

  test('search is capped at 100 characters', () => {
    const params = activityParams({ kind: 'preset', period: '7d' }, { ...DEFAULT_FILTERS, q: 'x'.repeat(150) })
    expect(params.get('q')).toHaveLength(100)
  })
})

describe('days (YYYY-MM-DD are calendar days, not UTC instants)', () => {
  test('custom range validation', () => {
    expect(customRangeError('2026-10-01', '2026-10-03')).toBeNull()
    expect(customRangeError('2026-10-03', '2026-10-03')).toBeNull()
    expect(customRangeError('', '2026-10-03')).toMatch(/obie daty/)
    expect(customRangeError('2026-02-30', '2026-03-01')).toMatch(/obie daty/)
    expect(customRangeError('2026-10-04', '2026-10-03')).toMatch(/wcześniejsza/)
    expect(customRangeError('2025-01-01', '2026-01-01')).toBeNull() // 366 dni
    expect(customRangeError('2025-01-01', '2026-01-02')).toMatch(/366/)
  })

  test('formatDay shows the same calendar day in any browser timezone', () => {
    expect(formatDay('2026-10-01', { day: 'numeric', month: 'numeric', year: 'numeric' })).toBe('1.10.2026')
    expect(formatDay('2026-12-31', { day: 'numeric', month: 'numeric' })).toBe('31.12')
    expect(formatDay('nie-data')).toBe('nie-data')
  })

  test('addDays crosses months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('labels for event types, unknown types stay visible', () => {
    expect(eventLabel('stock_change')).toBe('Zmiana zapasu')
    expect(eventLabel('reorder_rejected')).toBe('Odrzucenie zamówienia')
    expect(eventLabel('cos_nowego')).toBe('Inne zdarzenie (cos_nowego)')
  })
})

describe('shift times in the warehouse timezone', () => {
  test('datetime-local is read as Warsaw wall time with the right offset (summer and winter)', () => {
    expect(zonedInputToIso('2026-10-03T08:00', WARSAW)).toBe('2026-10-03T08:00:00+02:00')
    expect(zonedInputToIso('2026-12-03T08:30', WARSAW)).toBe('2026-12-03T08:30:00+01:00')
    expect(zonedInputToIso('2026-10-03T08:00', 'UTC')).toBe('2026-10-03T08:00:00+00:00')
    expect(Date.parse(zonedInputToIso('2026-10-03T08:00', WARSAW)!)).toBe(Date.parse('2026-10-03T06:00:00Z'))
    expect(zonedInputToIso('2026-10-03', WARSAW)).toBeNull()
  })

  test('ISO instants convert back to the warehouse wall time', () => {
    expect(isoToZonedInput('2026-10-03T06:00:00.000Z', WARSAW)).toBe('2026-10-03T08:00')
    expect(isoToZonedInput('2026-12-31T23:30:00.000Z', WARSAW)).toBe('2027-01-01T00:30')
  })

  test('day start in the warehouse timezone', () => {
    expect(zonedDayStart('2026-10-03', WARSAW)).toBe(Date.parse('2026-10-02T22:00:00Z'))
  })

  test('shift window: ordered, at most 48 h, not in the future', () => {
    const now = Date.parse('2026-10-03T12:00:00Z')
    expect(shiftWindow('2026-10-03T06:00', '2026-10-03T14:00', WARSAW, now)).toEqual({
      start: '2026-10-03T06:00:00+02:00',
      end: '2026-10-03T14:00:00+02:00',
    })
    expect(shiftWindow('', '2026-10-03T14:00', WARSAW, now)).toEqual({ error: 'Podaj początek i koniec zmiany.' })
    expect(shiftWindow('2026-10-03T14:00', '2026-10-03T06:00', WARSAW, now)).toMatchObject({ error: expect.stringMatching(/późniejszy/) })
    expect(shiftWindow('2026-10-01T06:00', '2026-10-03T07:00', WARSAW, now)).toMatchObject({ error: expect.stringMatching(/48/) })
    expect(shiftWindow('2026-10-03T13:00', '2026-10-03T15:00', WARSAW, now)).toMatchObject({ error: expect.stringMatching(/przyszłości/) })
  })
})

describe('requests', () => {
  const assign = vi.fn()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assign.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { location: { pathname: '/', assign } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  test('endpoints and parameters', async () => {
    fetchMock.mockImplementation(async () => json(200, {}))
    await fetchDashboard({ kind: 'preset', period: '7d' })
    await fetchActivity({ kind: 'custom', from: '2026-10-01', to: '2026-10-02' }, DEFAULT_FILTERS, 3)
    await fetchShift(null)
    await fetchShift({ start: '2026-10-03T08:00:00+02:00', end: '2026-10-03T16:00:00+02:00' })
    await fetchTrend(5, { kind: 'preset', period: 'today' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard?period=7d',
      '/api/dashboard/activity?from=2026-10-01&to=2026-10-02&status=all&page=3&page_size=25',
      '/api/dashboard/shift',
      // „+” w offsecie musi być zakodowany
      '/api/dashboard/shift?start=2026-10-03T08%3A00%3A00%2B02%3A00&end=2026-10-03T16%3A00%3A00%2B02%3A00',
      '/api/dashboard/items/5/trend?period=today',
    ])
  })

  test('errors carry the server detail and status; 401 goes to login', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { detail: 'Zakres musi obejmować od 1 do 366 dni.' }))
    await expect(fetchDashboard({ kind: 'custom', from: '2024-01-01', to: '2026-01-01' })).rejects.toMatchObject({
      status: 422,
      message: 'Zakres musi obejmować od 1 do 366 dni.',
    })
    fetchMock.mockResolvedValueOnce(json(401, { detail: 'Zaloguj się.' }))
    await expect(fetchDashboard({ kind: 'preset', period: '7d' })).rejects.toMatchObject({ status: 401 })
    expect(assign).toHaveBeenCalledWith('/login')
  })

  test('CSV export: same filters without paging; JSON errors are never downloaded', async () => {
    fetchMock.mockResolvedValueOnce(new Response('﻿ID;Czas UTC\r\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }))
    const blob = await exportActivityCsv({ kind: 'preset', period: '7d' }, { ...DEFAULT_FILTERS, status: 'undone', itemId: '1' })
    expect(await blob.text()).toContain('ID;Czas UTC')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/dashboard/activity/export?period=7d&item_id=1&status=undone')

    fetchMock.mockResolvedValueOnce(json(413, { detail: 'Eksport przekracza 4 MB. Zawęź daty lub filtry.' }))
    await expect(exportActivityCsv({ kind: 'preset', period: '30d' }, DEFAULT_FILTERS)).rejects.toMatchObject({
      status: 413,
      message: 'Eksport przekracza 4 MB. Zawęź daty lub filtry.',
    })
  })
})
