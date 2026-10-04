'use client'

import { useMemo } from 'react'
import { boundsOf, projectionFor, type PathMarker, type PathPoint } from '@/lib/pdr'

export type PathShape = {
  points: PathPoint[]
  markers?: PathMarker[]
  color?: string
  label?: string
}

type Props = {
  shapes: PathShape[]
  width?: number
  height?: number
  /** Tryb ręczny: klik w mapę dopisuje punkt ścieżki. */
  onPick?: (meters: { x: number; y: number }) => void
  /** Klik w znacznik (np. znacznik ze strefą → wybór strefy na mapie). */
  onMarkerClick?: (marker: PathMarker) => void
  ariaLabel?: string
  showStartLabel?: boolean
}

export const PATH_COLORS = ['#315b37', '#a45d52', '#3a5a80', '#805c12', '#5b3a80']

/** Rzut ścieżek w metrach: siatka 1-2-5, północ u góry, START na zielonym punkcie. */
export default function PathMap({
  shapes,
  width = 640,
  height = 420,
  onPick,
  onMarkerClick,
  ariaLabel = 'Rzeczywisty rzut ścieżek w metrach',
  showStartLabel = true,
}: Props) {
  const proj = useMemo(() => projectionFor(boundsOf(shapes), width, height, 36), [shapes, width, height])
  const step = proj.gridStepM
  const bounds = boundsOf(shapes)

  const gridLines: { x1: number; y1: number; x2: number; y2: number; label: string; lx: number; ly: number }[] = []
  for (let mx = Math.ceil(bounds.minX / step) * step; mx <= bounds.maxX + step / 2; mx += step) {
    const a = proj.toSvg({ x: mx, y: bounds.minY })
    const b = proj.toSvg({ x: mx, y: bounds.maxY })
    gridLines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: `${mx}`, lx: a.x, ly: height - 6 })
  }
  for (let my = Math.ceil(bounds.minY / step) * step; my <= bounds.maxY + step / 2; my += step) {
    const a = proj.toSvg({ x: bounds.minX, y: my })
    const b = proj.toSvg({ x: bounds.maxX, y: my })
    gridLines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: `${my}`, lx: 4, ly: a.y })
  }

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return
    const rect = event.currentTarget.getBoundingClientRect()
    const sx = ((event.clientX - rect.left) * width) / rect.width
    const sy = ((event.clientY - rect.top) * height) / rect.height
    onPick(proj.fromSvg(sx, sy))
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={'w-full ' + (onPick ? 'cursor-crosshair' : '')}
      role="img"
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      <rect x={0} y={0} width={width} height={height} fill="#fbfaf7" />
      {gridLines.map((line, index) => (
        <g key={index}>
          <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#e3e1d8" strokeWidth={1} />
          <text x={line.lx + 2} y={line.ly} fill="#a8a69d" fontSize={9}>{line.label}</text>
        </g>
      ))}
      {shapes.map((shape, shapeIndex) => {
        const color = shape.color ?? PATH_COLORS[shapeIndex % PATH_COLORS.length]!
        if (shape.points.length === 0) return null
        const d = shape.points
          .map((point, index) => {
            const svg = proj.toSvg(point)
            return `${index === 0 ? 'M' : 'L'}${svg.x.toFixed(1)} ${svg.y.toFixed(1)}`
          })
          .join(' ')
        const start = proj.toSvg(shape.points[0]!)
        const last = proj.toSvg(shape.points[shape.points.length - 1]!)
        return (
          <g key={shapeIndex}>
            <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
            <circle cx={start.x} cy={start.y} r={6} fill={color} stroke="#ffffff" strokeWidth={2} />
            {showStartLabel && (
              <text x={start.x + 9} y={start.y + 4} fill={color} fontSize={11} fontWeight={700}>START</text>
            )}
            <circle cx={last.x} cy={last.y} r={4} fill="#292d2b" />
            {shape.label && (
              <text x={last.x + 8} y={last.y - 8} fill="#292d2b" fontSize={11} fontWeight={700}>{shape.label}</text>
            )}
            {(shape.markers ?? []).map((marker, markerIndex) => {
              const svg = proj.toSvg(marker)
              const interactive = onMarkerClick !== undefined
              return (
                <g
                  key={markerIndex}
                  className={interactive ? 'cursor-pointer' : undefined}
                  onClick={
                    interactive
                      ? (event) => {
                          event.stopPropagation()
                          onMarkerClick(marker)
                        }
                      : undefined
                  }
                >
                  <rect x={svg.x - 5} y={svg.y - 5} width={10} height={10} fill="#a45d52" stroke="#ffffff" strokeWidth={1.5} />
                  <text x={svg.x + 8} y={svg.y + 4} fill="#292d2b" fontSize={11} fontWeight={600}>{marker.label}</text>
                </g>
              )
            })}
          </g>
        )
      })}
      {onPick && (
        <text x={width / 2} y={18} textAnchor="middle" fill="#70756f" fontSize={11}>
          tryb ręczny · klikaj kolejne punkty przejścia · kratka = {step} m
        </text>
      )}
    </svg>
  )
}
