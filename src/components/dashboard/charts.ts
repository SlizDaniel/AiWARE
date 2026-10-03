// Geometria wykresów dashboardu (czyste funkcje, testowane osobno od SVG).
import type { StockTrendResponse } from '@/lib/dashboard'

export type TrendPoint = StockTrendResponse['points'][number]
export type StepVertex = { t: number; v: number }
export type TrendGap = { t: number; from: number; to: number; auditId: number }

/** Zaokrąglenie maksimum osi w górę do „ładnej” wartości (1, 2, 5 × 10^n), minimum 1. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const fraction = value / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * power
}

/** Co który dzień podpisać, żeby zmieścić najwyżej `maxLabels` etykiet. */
export function labelStep(count: number, maxLabels: number): number {
  return count <= maxLabels ? 1 : Math.ceil(count / Math.max(1, maxLabels))
}

function pointTime(point: TrendPoint): number {
  return Date.parse(point.ts)
}

/**
 * Linia schodkowa zapasu: odcinki poziome (stan trwa) i pionowe (operacja before → after).
 * `continuous=false` przerywa linię — nowy odcinek zaczyna się od `before` punktu, a rozbieżność
 * trafia do `gaps`. Bez znanego otwarcia linia zaczyna się dopiero na pierwszym punkcie.
 */
export function buildStepSeries(
  points: readonly TrendPoint[],
  opening: number | null,
  startMs: number,
  endMs: number,
): { segments: StepVertex[][]; gaps: TrendGap[] } {
  const sorted = [...points].sort((a, b) => pointTime(a) - pointTime(b) || a.audit_id - b.audit_id)
  const clamp = (t: number) => Math.min(Math.max(t, startMs), endMs)
  const segments: StepVertex[][] = []
  const gaps: TrendGap[] = []
  let current: StepVertex[] | null = opening === null ? null : [{ t: startMs, v: opening }]
  let level: number | null = opening

  for (const point of sorted) {
    const t = clamp(pointTime(point))
    if (current && level !== null && point.continuous) {
      current.push({ t, v: level }, { t, v: point.after })
    } else {
      if (current && level !== null) {
        current.push({ t, v: level })
        segments.push(current)
      }
      if (level !== null && !point.continuous) gaps.push({ t, from: level, to: point.before, auditId: point.audit_id })
      current = [
        { t, v: point.before },
        { t, v: point.after },
      ]
    }
    level = point.after
  }
  if (current && level !== null) {
    current.push({ t: endMs, v: level })
    segments.push(current)
  }
  return { segments, gaps }
}

/** Zakres osi Y: od zera (lub ujemnego minimum) do ładnego maksimum z zapasem. */
export function valueDomain(values: readonly number[]): { min: number; max: number } {
  const finite = values.filter((value) => Number.isFinite(value))
  const low = Math.min(0, ...finite)
  const high = Math.max(1, ...finite)
  return { min: low < 0 ? -niceMax(-low) : 0, max: niceMax(high * 1.05) }
}
