// Mobile mapping: kompas z magnetometru, geometria kanwy (segmenty/tap→metry)
// i metody API mapowania w transporcie mobilnym.
import { describe, expect, it, vi } from 'vitest'
import { compassHeadingDeg } from '../mobile/src/lib/imu'
import { CANVAS_H, CANVAS_W, canvasGeometry, tapToMeters } from '../mobile/src/lib/mapping'
import { createApi } from '../mobile/src/lib/client'
import type { MapPath, MapSector } from '../mobile/src/lib/contracts'

function makePath(points: [number, number][]): MapPath {
  return {
    id: 1, name: 'Testowa', step_length: 0.7, actor: 'test', created: '2026-10-04 00:00:00',
    points: points.map(([x, y], t) => ({ x, y, t: t * 800 })),
    markers: [{ x: points[points.length - 1]![0]!, y: points[points.length - 1]![1]!, label: 'A-01', zone: 'kartony' }],
  }
}

function makeSector(): MapSector {
  return { id: 7, name: 'Sektor A1', x: 1.2, y: 0.8, actor: 'test', created: '2026-10-04 00:00:00', items: [] }
}

describe('compassHeadingDeg (magnetometr, telefon płasko)', () => {
  it('północ (pole wzdłuż +y) → 0°', () => {
    expect(compassHeadingDeg(0, 50)).toBeCloseTo(0)
  })
  it('wschód (pole wzdłuż +x) → 90°', () => {
    expect(compassHeadingDeg(50, 0)).toBeCloseTo(90)
  })
  it('południe → 180°, zachód → 270°', () => {
    expect(compassHeadingDeg(0, -50)).toBeCloseTo(180)
    expect(compassHeadingDeg(-50, 0)).toBeCloseTo(270)
  })
  it('koryguje obrót ekranu', () => {
    expect(compassHeadingDeg(0, 50, 90)).toBeCloseTo(270)
    expect(compassHeadingDeg(50, 0, 90)).toBeCloseTo(0)
  })
})

describe('canvasGeometry (rzut na kanwę RN)', () => {
  const path = makePath([[0, 0], [2, 0], [2, 2]])
  const geometry = canvasGeometry([path], [makeSector()])

  it('kanwa ma stały rozmiar, siatka ≥ rozsądnego rozmiaru', () => {
    expect(CANVAS_W).toBeGreaterThan(0)
    expect(geometry.gridStepM * geometry.proj.scale).toBeGreaterThanOrEqual(24)
  })

  it('segment wschodni leży poziomo (kąt 0°), północny pionowo do góry (−90°)', () => {
    const east = geometry.segments.find(segment => segment.length > 30 && Math.abs(segment.angleDeg) < 1)
    expect(east).toBeDefined()
    const north = geometry.segments.find(segment => segment.angleDeg < -89)
    expect(north).toBeDefined()
  })

  it('znacznik i sektor mają pola do pozycjonowania i etykiety', () => {
    expect(geometry.markers[0]!.label).toBe('A-01')
    const sector = geometry.sectors[0]!
    expect(sector.label).toBe('Sektor A1')
    expect(sector.left).toBeGreaterThanOrEqual(0)
    expect(sector.top).toBeGreaterThanOrEqual(0)
  })

  it('dotyk na kanwie zamienia się na metry i wraca na te same piksele', () => {
    const tapX = CANVAS_W / 2
    const tapY = CANVAS_H / 2
    const meters = tapToMeters(geometry.proj, tapX, tapY)
    const back = geometry.proj.toSvg(meters)
    // tapToMeters zaokrągla do 0,1 m → tolerancja rośnie ze skalą
    const tolerance = geometry.proj.scale * 0.05 + 0.6
    expect(Math.abs(back.x - tapX)).toBeLessThan(tolerance)
    expect(Math.abs(back.y - tapY)).toBeLessThan(tolerance)
    expect(Math.abs(meters.x * 10 - Math.round(meters.x * 10))).toBeLessThan(1e-9) // zaokrąglenie do 0,1 m
  })

  it('puste wejście nie wywala się i daje START na środku', () => {
    const empty = canvasGeometry([], [])
    expect(empty.segments).toEqual([])
    expect(empty.start.left).toBe(CANVAS_W / 2)
  })
})

describe('mobile API: mapowanie i sektory', () => {
  it('pobiera ścieżki i sektory z odpowiednich endpointów', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ paths: [], sectors: [] }))
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    await api.mapPaths()
    await api.mapSectors()
    expect(fetcher.mock.calls[0][0]).toBe('https://warehouse.example/api/map-paths')
    expect(fetcher.mock.calls[1][0]).toBe('https://warehouse.example/api/map-sectors')
  })

  it('zapisuje ścieżkę POST-em z punktami i znacznikami', async () => {
    const saved = makePath([[0, 0], [0.7, 0]])
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ path: saved }))
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    const result = await api.saveMapPath({ name: 'Testowa', step_length: 0.7, points: saved.points, markers: saved.markers })
    expect(result.name).toBe('Testowa')
    const call = fetcher.mock.calls[0]!
    expect(call[0]).toBe('https://warehouse.example/api/map-paths')
    expect(call[1]!.method).toBe('POST')
    expect(JSON.parse(String(call[1]!.body)).points).toHaveLength(2)
  })

  it('przypisanie przedmiotu trafia pod /items z liczbą całkowitą', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ sector: makeSector() }))
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    await api.assignSectorItem(7, { item_id: 2, quantity: 10 })
    const call = fetcher.mock.calls[0]!
    expect(call[0]).toBe('https://warehouse.example/api/map-sectors/7/items')
    expect(call[1]!.method).toBe('PUT')
    expect(JSON.parse(String(call[1]!.body))).toEqual({ item_id: 2, quantity: 10 })
  })

  it('usunięcia używają DELETE', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ deleted: 7 }))
    const api = createApi('https://warehouse.example', async () => 'token', fetcher)
    await api.deleteMapSector(7)
    await api.deleteMapPath(3)
    await api.unassignSectorItem(7, 2)
    expect(fetcher.mock.calls.map(call => [call[1]!.method, call[0]])).toEqual([
      ['DELETE', 'https://warehouse.example/api/map-sectors/7'],
      ['DELETE', 'https://warehouse.example/api/map-paths/3'],
      ['DELETE', 'https://warehouse.example/api/map-sectors/7/items/2'],
    ])
  })
})
