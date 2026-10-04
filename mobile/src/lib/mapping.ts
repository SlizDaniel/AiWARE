// Czysta geometria rzutu na kanwę RN: segmenty ścieżek, znaczniki i sektory jako
// prostokąty do absolutnego pozycjonowania (bez react-native-svg). Testowalna bez RN.
import { boundsOf, projectionFor, type Projection } from '../../../src/lib/pdr'
import type { MapPath, MapSector } from './contracts'
import { JUNCTION_PREFIX } from './guidedScan'

export const CANVAS_W = 320
export const CANVAS_H = 240
/** Powyżej tej liczby punktów ścieżka jest próbkowana co n-ty — RN nie lubi tysięcy Views. */
const MAX_DRAWN_POINTS = 150

export const PATH_COLORS = ['#315b45', '#a45d52', '#3a5a80', '#805c12', '#5b3a80']
export const SECTOR_COLOR = '#3a5a80'

export type Segment = { key: string; left: number; top: number; length: number; angleDeg: number; color: string }
export type MarkerBox = { key: string; left: number; top: number; label: string; color: string; active?: boolean }

export type CanvasGeometry = {
  proj: Projection
  gridStepM: number
  start: { left: number; top: number }
  segments: Segment[]
  markers: MarkerBox[]
  sectors: MarkerBox[]
}

function pathColor(index: number): string {
  return PATH_COLORS[index % PATH_COLORS.length]!
}

/** Skaluje metry na kanwę (północ u góry) i zwraca elementy do narysowania. */
export function canvasGeometry(paths: MapPath[], sectors: MapSector[], width = CANVAS_W, height = CANVAS_H): CanvasGeometry {
  const shapes = [
    ...paths.map(path => ({ points: path.points, markers: path.markers })),
    ...sectors.map(sector => ({ points: [], markers: [{ x: sector.x, y: sector.y, label: sector.name }] })),
  ]
  const proj = projectionFor(boundsOf(shapes), width, height, 18)
  const segments: Segment[] = []
  const markers: MarkerBox[] = []

  paths.forEach((path, pathIndex) => {
    const stride = Math.max(1, Math.ceil(path.points.length / MAX_DRAWN_POINTS))
    const points = path.points.filter((_, index) => index % stride === 0 || index === path.points.length - 1)
    for (let i = 1; i < points.length; i++) {
      const a = proj.toSvg(points[i - 1]!)
      const b = proj.toSvg(points[i]!)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      if (length < 0.5) continue
      segments.push({
        key: `${path.id}-${i}`,
        left: (a.x + b.x) / 2 - length / 2,
        top: (a.y + b.y) / 2 - 1.25,
        length,
        angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
        color: pathColor(pathIndex),
      })
    }
    for (const marker of path.markers) {
      const box = proj.toSvg(marker)
      const label = marker.label.startsWith(JUNCTION_PREFIX) ? marker.label.slice(JUNCTION_PREFIX.length) : marker.label
      if (markers.some(item => item.label === label && Math.abs(item.left - (box.x - 5)) < 0.1 && Math.abs(item.top - (box.y - 5)) < 0.1)) continue
      markers.push({ key: `${path.id}-m-${marker.label}-${marker.x},${marker.y}`, left: box.x - 5, top: box.y - 5, label, color: pathColor(pathIndex) })
    }
  })

  const sectorBoxes: MarkerBox[] = sectors.map(sector => {
    const box = proj.toSvg(sector)
    return { key: `s-${sector.id}`, left: box.x - 8, top: box.y - 8, label: sector.name, color: SECTOR_COLOR, active: false }
  })

  const startPoint = paths.flatMap(path => path.markers).find(marker => marker.label === JUNCTION_PREFIX + 'START') ?? paths[0]?.points[0]
  const startSvg = startPoint ? proj.toSvg(startPoint) : null
  return {
    proj,
    gridStepM: proj.gridStepM,
    start: startSvg ? { left: startSvg.x, top: startSvg.y } : { left: width / 2, top: height / 2 },
    segments,
    markers,
    sectors: sectorBoxes,
  }
}

/** Klik/dotyk na kanwie [px] → metry od startu (np. nowe punkty i sektory). */
export function tapToMeters(proj: Projection, x: number, y: number): { x: number; y: number } {
  const meters = proj.fromSvg(x, y)
  return { x: Math.round(meters.x * 10) / 10, y: Math.round(meters.y * 10) / 10 }
}

export { pathColor as pathColorFor }
