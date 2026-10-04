import { useCallback, useRef, useState, type KeyboardEvent, type SVGProps } from 'react'
import type { DashboardResponse } from '@/lib/dashboard'
import { formatDay, formatRange } from '@/lib/dashboardApi'
import { stockLevel } from '../ui/stockLevel'
import { panelClass } from '../ui/styles'
import { labelStep, niceMax } from './charts'
import { axisTicks, Card, ChartTooltip, EmptyNote, plural, ReadoutLine, tickLabel, TooltipRow, type ReadoutItem } from './ui'

/** Historia zapasu: linia schodkowa na osi (ta sama gramatyka co ikony w `ui/icons`). */
function TrendIcon({ size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M3 3.5v13h13.5" />
      <path d="M6 7h3v3.5h3V13h3.5" />
    </svg>
  )
}

/** Próbka koloru serii w nagłówku kolumny (jak słupki: pobrania ciemne, przyjęcia jasne). */
function SeriesKey({ light = false }: { light?: boolean }) {
  return <span aria-hidden="true" className={'inline-block size-2 rounded-[2px] ' + (light ? 'bg-ink-2/40' : 'bg-ink-2')} />
}

/**
 * B: stan teraz. C: wybrany okres. Jeden panel, dwa wiersze odczytu w linii (bez kafelków).
 * Sumy pobrań, przyjęć i cofnięć okresu są w legendzie wykresu dziennego — tu ich nie powtarzamy.
 */
export function SummaryTiles({ data }: { data: DashboardResponse }) {
  const { current, period, range, attention } = data
  const anyEmpty = attention.below_minimum.some((item) => stockLevel(item.quantity, item.minimum) === 'empty')
  const now: ReadoutItem[] = [
    { value: current.total_items, label: plural(current.total_items, 'towar', 'towary', 'towarów') },
    { value: current.below_minimum, label: 'poniżej minimum', kind: current.below_minimum > 0 ? (anyEmpty ? 'alarm' : 'warn') : null },
    {
      value: current.pending_drafts,
      label: plural(current.pending_drafts, 'oczekujący szkic', 'oczekujące szkice', 'oczekujących szkiców'),
      kind: current.pending_drafts > 0 ? 'decision' : null,
    },
    { value: current.missing_location, label: 'bez lokalizacji', kind: current.missing_location > 0 ? 'near' : null },
  ]
  const inPeriod: ReadoutItem[] = [
    {
      value: period.audit_events,
      label: plural(period.audit_events, 'wpis audytu', 'wpisy audytu', 'wpisów audytu'),
      note: `w tym import pozycji: ${period.import_events}`,
    },
  ]
  return (
    <div className={`${panelClass} @container divide-y divide-line`}>
      <ReadoutGroup id="dash-now" title="Stan teraz" description="Bieżący stan magazynu — niezależnie od wybranego okresu." items={now} />
      <ReadoutGroup id="dash-period" title="W wybranym okresie" description={`${formatRange(range)} · strefa ${range.timezone}`} items={inPeriod} />
    </div>
  )
}

function ReadoutGroup({ id, title, description, items }: { id: string; title: string; description: string; items: ReadoutItem[] }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-8 gap-y-2 px-6 py-4 @3xl:grid-cols-[15rem_minmax(0,1fr)] @3xl:items-center">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold leading-snug text-ink">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-mute">{description}</p>
      </div>
      <ReadoutLine items={items} />
    </section>
  )
}

/** D: operacje dziennie + najczęściej zmieniane towary. */
export function ActivityCharts({ data, onShowTrend }: { data: DashboardResponse; onShowTrend: (itemId: number) => void }) {
  const totals = data.daily.reduce(
    (sum, day) => ({ w: sum.w + day.withdrawals, r: sum.r + day.receipts, u: sum.u + day.undo_count }),
    { w: 0, r: 0, u: 0 },
  )
  const topMax = Math.max(1, ...data.most_changed_items.map((item) => item.stock_changes))
  return (
    <div className="grid gap-6 @4xl:grid-cols-2">
      <Card title="Operacje dziennie" subtitle="Liczba operacji w każdym dniu zakresu (także dni bez operacji)." fill>
        {data.daily.length === 0 ? (
          <EmptyNote>Brak dni w wybranym zakresie.</EmptyNote>
        ) : (
          <>
            <div className="space-y-1.5">
              <Legend totals={totals} />
              <p className="text-xs text-mute">Pobrania i przyjęcia to liczby operacji, nie sztuk — różnych jednostek nie sumujemy.</p>
            </div>
            <DailyChart daily={data.daily} summary={`Razem: pobrania ${totals.w}, przyjęcia ${totals.r}, cofnięcia ${totals.u}.`} />
          </>
        )}
      </Card>
      <Card title="Najczęściej zmieniane" subtitle="Top 10 towarów według liczby zmian zapasu w okresie.">
        {data.most_changed_items.length === 0 ? (
          <EmptyNote>Brak zmian zapasu w wybranym okresie.</EmptyNote>
        ) : (
          <div className="relative -mx-6 -mb-6 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <caption className="sr-only">Top 10 towarów według liczby zmian zapasu w okresie</caption>
              <thead>
                <tr>
                  <th scope="col" className="label-caps py-2.5 pl-6 pr-4 text-left">Towar</th>
                  <th scope="col" className="label-caps whitespace-nowrap py-2.5 pr-4 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <SeriesKey />
                      Pobrania
                    </span>
                  </th>
                  <th scope="col" className="label-caps whitespace-nowrap py-2.5 pr-4 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <SeriesKey light />
                      Przyjęcia
                    </span>
                  </th>
                  <th scope="col" className="label-caps py-2.5 pr-2 text-right">Zmiany</th>
                  <th scope="col" className="py-2.5 pr-4">
                    <span className="sr-only">Historia zapasu</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.most_changed_items.map((item, index) => {
                  const other = Math.max(0, item.stock_changes - item.withdrawals - item.receipts)
                  return (
                    <tr key={`${item.item_id ?? 'x'}-${index}`} className="border-t border-line transition-colors duration-150 hover:bg-ground/50">
                      <th scope="row" className="w-full max-w-0 py-2 pl-6 pr-4 text-left font-normal">
                        <div className="flex min-w-0 items-baseline gap-2.5">
                          <span className="narrow w-5 shrink-0 text-[13px] font-semibold tabular-nums text-mute">{String(index + 1).padStart(2, '0')}</span>
                          <span className="min-w-0 truncate font-semibold text-ink" title={item.item_name}>
                            {item.item_name}
                          </span>
                        </div>
                        {/* słupek: pobrania (ciemne) + przyjęcia (jasne) + inne zmiany, długość względem lidera */}
                        <div className="ml-[1.875rem] mt-1.5" aria-hidden="true">
                          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]" style={{ width: `${Math.max(3, (item.stock_changes / topMax) * 100)}%` }}>
                            {item.withdrawals > 0 && <span className="bg-ink-2" style={{ flexGrow: item.withdrawals }} />}
                            {item.receipts > 0 && <span className="bg-ink-2/40" style={{ flexGrow: item.receipts }} />}
                            {other > 0 && <span className="bg-band" style={{ flexGrow: other }} />}
                          </div>
                        </div>
                      </th>
                      <td className="py-2 pr-4 text-right tabular-nums text-ink-2">{item.withdrawals}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-ink-2">{item.receipts}</td>
                      <td className="py-2 pr-2 text-right font-semibold tabular-nums text-ink">{item.stock_changes}</td>
                      <td className="py-1.5 pr-4 text-right">
                        {item.item_id !== null && (
                          <button
                            type="button"
                            onClick={() => onShowTrend(item.item_id as number)}
                            aria-label={`Historia zapasu: ${item.item_name}`}
                            title="Historia zapasu"
                            className="inline-flex size-8 items-center justify-center rounded-md text-mute transition-colors duration-150 hover:bg-ink/6 hover:text-act-ink"
                          >
                            <TrendIcon />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// Wykres lustrzany: przyjęcia nad osią, pobrania pod osią (położenie niesie serię, nie kolor),
// cofnięcia jako romb na osi — kolor tylko dla korekty (akcja operatora).
const BAR_RADIUS = 2.5

/** Słupek zaokrąglony tylko na końcu danych, prosty przy osi. `y1` < `y0` — w górę, `y1` > `y0` — w dół. */
function barPath(x: number, width: number, y0: number, y1: number): string {
  const up = y1 < y0
  const height = Math.abs(y0 - y1)
  const r = Math.min(BAR_RADIUS, height, width / 2)
  const end = up ? y1 + r : y1 - r
  return [
    `M${x},${y0}`,
    `V${end}`,
    `Q${x},${y1} ${x + r},${y1}`,
    `H${x + width - r}`,
    `Q${x + width},${y1} ${x + width},${end}`,
    `V${y0}`,
    'Z',
  ].join(' ')
}

function UpSwatch() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M3 9V3.5Q3 2 4.5 2h3Q9 2 9 3.5V9Z" className="fill-ink-2" fillOpacity={0.42} />
      <path d="M0.5 10.25h11" className="stroke-line-strong" strokeWidth="1.5" />
    </svg>
  )
}

function DownSwatch() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M3 3v5.5Q3 10 4.5 10h3Q9 10 9 8.5V3Z" className="fill-ink-2" />
      <path d="M0.5 1.75h11" className="stroke-line-strong" strokeWidth="1.5" />
    </svg>
  )
}

function UndoSwatch() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" className="fill-act" />
    </svg>
  )
}

function Legend({ totals }: { totals: { w: number; r: number; u: number } }) {
  const entry = 'inline-flex items-center gap-2'
  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-2" aria-label="Legenda i sumy w okresie">
      <li className={entry}>
        <UpSwatch />
        Przyjęcia
        <span className="font-semibold tabular-nums text-ink">{totals.r}</span>
      </li>
      <li className={entry}>
        <DownSwatch />
        Pobrania
        <span className="font-semibold tabular-nums text-ink">{totals.w}</span>
      </li>
      <li className={entry}>
        <UndoSwatch />
        Cofnięcia
        <span className="font-semibold tabular-nums text-ink">{totals.u}</span>
      </li>
    </ul>
  )
}

/**
 * Szerokość i wysokość kontenera (ResizeObserver). Wykres wypełnia wysokość panelu obok wyższego
 * sąsiada w siatce; SVG leży absolutnie, więc nie wpływa na wysokość, którą mierzy.
 */
function useBox<T extends HTMLElement>() {
  const [box, setBox] = useState({ width: 640, height: 240 })
  const observerRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const measure = (width: number, height: number) => {
      const next = { width: Math.floor(width), height: Math.floor(height) }
      if (next.width > 0 && next.height > 0) setBox((current) => (current.width === next.width && current.height === next.height ? current : next))
    }
    measure(node.clientWidth, node.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) measure(rect.width, rect.height)
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])
  return [ref, box] as const
}

// podpis w wykresie jak `label-caps`: wersaliki, zwężony krój, kolor wyciszony, obwódka w kolorze tła
const SIDE_LABEL = 'fill-mute stroke-sheet uppercase'
const SIDE_LABEL_STYLE = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', fontVariationSettings: "'wdth' 82" } as const

const CHART_MIN_HEIGHT = 240
const CHART_MAX_HEIGHT = 420

function DailyChart({ daily, summary }: { daily: DashboardResponse['daily']; summary: string }) {
  const [ref, box] = useBox<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const width = box.width
  const height = Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, box.height))
  const margin = { top: 10, right: 4, bottom: 28, left: 30 }
  const plotW = Math.max(40, width - margin.left - margin.right)
  const plotH = height - margin.top - margin.bottom
  const half = plotH / 2
  const zero = margin.top + half
  // wspólna skala dla obu stron osi — słupki nad i pod osią da się porównać wprost
  const max = niceMax(Math.max(...daily.flatMap((day) => [day.withdrawals, day.receipts])))
  const ticks = axisTicks(0, max, half > 200 ? 4 : 2).filter((tick) => tick > 0)
  const group = plotW / daily.length
  const bar = Math.max(2, Math.min(22, group * 0.6))
  const every = labelStep(daily.length, Math.max(2, Math.floor(plotW / 58)))
  const offset = (value: number) => (value / max) * half
  const day = active === null ? null : daily[active]

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    setActive((current) => {
      const last = daily.length - 1
      if (event.key === 'Home') return 0
      if (event.key === 'End') return last
      if (current === null) return last
      return Math.min(last, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)))
    })
  }

  return (
    <div ref={ref} className="relative min-h-60 w-full min-w-0 flex-1">
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Wykres operacji dziennie: przyjęcia nad osią, pobrania pod osią, cofnięcia jako romby na osi. ${summary} Strzałki w lewo i w prawo pokazują kolejne dni.`}
        className="absolute left-0 top-0 block rounded-sm"
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? daily.length - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={margin.left + plotW} y1={zero - offset(tick)} y2={zero - offset(tick)} className="stroke-line" />
            <line x1={margin.left} x2={margin.left + plotW} y1={zero + offset(tick)} y2={zero + offset(tick)} className="stroke-line" />
            <text x={margin.left - 8} y={zero - offset(tick) + 4} textAnchor="end" fontSize="11" className="fill-mute tabular-nums">
              {tickLabel(tick)}
            </text>
            <text x={margin.left - 8} y={zero + offset(tick) + 4} textAnchor="end" fontSize="11" className="fill-mute tabular-nums">
              {tickLabel(tick)}
            </text>
          </g>
        ))}
        <text x={margin.left - 8} y={zero + 4} textAnchor="end" fontSize="11" className="fill-mute tabular-nums">
          0
        </text>

        {active !== null && (
          <rect x={margin.left + active * group} y={margin.top} width={group} height={plotH} rx="3" className="fill-ink" fillOpacity={0.045} />
        )}

        {daily.map((entry, index) => {
          const x = margin.left + index * group + (group - bar) / 2
          const dim = active !== null && active !== index
          return (
            <g key={entry.date} opacity={dim ? 0.55 : 1} className="transition-opacity duration-150">
              {entry.receipts > 0 && <path d={barPath(x, bar, zero - 1, zero - 1 - offset(entry.receipts))} className="fill-ink-2" fillOpacity={0.42} />}
              {entry.withdrawals > 0 && <path d={barPath(x, bar, zero + 1, zero + 1 + offset(entry.withdrawals))} className="fill-ink-2" />}
              {index % every === 0 && (
                <text x={margin.left + index * group + group / 2} y={height - 8} textAnchor="middle" fontSize="11" className="fill-mute tabular-nums">
                  {formatDay(entry.date)}
                </text>
              )}
            </g>
          )
        })}

        <line x1={margin.left} x2={margin.left + plotW} y1={zero} y2={zero} className="stroke-line-strong" />

        {/* podpisy stron osi: nad osią przyjęcia, pod osią pobrania (podziałka jest lustrzana) */}
        <text x={margin.left + 6} y={margin.top + 12} className={SIDE_LABEL} style={SIDE_LABEL_STYLE} strokeWidth="3" paintOrder="stroke">
          przyjęcia
        </text>
        <text x={margin.left + 6} y={margin.top + plotH - 6} className={SIDE_LABEL} style={SIDE_LABEL_STYLE} strokeWidth="3" paintOrder="stroke">
          pobrania
        </text>

        {daily.map((entry, index) => {
          if (entry.undo_count <= 0) return null
          const cx = margin.left + index * group + group / 2
          const r = Math.max(3.5, Math.min(5, bar / 2 + 1))
          return (
            <path
              key={`undo-${entry.date}`}
              d={`M${cx},${zero - r} L${cx + r},${zero} L${cx},${zero + r} L${cx - r},${zero} Z`}
              className="fill-act stroke-sheet"
              strokeWidth="2"
              paintOrder="stroke"
            />
          )
        })}

        {/* pole trafienia: cały dzień, nie tylko słupek */}
        {daily.map((entry, index) => (
          <rect
            key={`hit-${entry.date}`}
            x={margin.left + index * group}
            y={margin.top}
            width={group}
            height={plotH}
            fill="transparent"
            onPointerEnter={() => setActive(index)}
          />
        ))}
      </svg>

      {day && active !== null && (
        <ChartTooltip x={margin.left + active * group + group / 2} y={margin.top} width={width}>
          <p className="font-semibold text-ink">{formatDay(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <TooltipRow swatch={<UpSwatch />} value={day.receipts} label="przyjęcia" />
          <TooltipRow swatch={<DownSwatch />} value={day.withdrawals} label="pobrania" />
          <TooltipRow swatch={<UndoSwatch />} value={day.undo_count} label="cofnięcia" />
        </ChartTooltip>
      )}

      <table className="sr-only">
        <caption>Operacje dziennie</caption>
        <thead>
          <tr>
            <th scope="col">Dzień</th>
            <th scope="col">Przyjęcia</th>
            <th scope="col">Pobrania</th>
            <th scope="col">Cofnięcia</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((entry) => (
            <tr key={entry.date}>
              <th scope="row">{formatDay(entry.date, { weekday: 'short', day: 'numeric', month: 'short' })}</th>
              <td>{entry.receipts}</td>
              <td>{entry.withdrawals}</td>
              <td>{entry.undo_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
