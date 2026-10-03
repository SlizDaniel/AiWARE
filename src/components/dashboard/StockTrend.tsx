import { useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { Item } from '@/lib/api'
import type { StockTrendResponse } from '@/lib/dashboard'
import { addDays, eventLabel, fetchTrend, formatDateTime, formatDay, formatRange, zonedDayStart, type PeriodSelection } from '@/lib/dashboardApi'
import { ChevronIcon, UndoIcon } from '../ui/icons'
import RangeIndicator from '../ui/RangeIndicator'
import { StateShape, stateTextClass } from '../ui/StateMark'
import { STOCK_LEVEL, stockLevel } from '../ui/stockLevel'
import { buildStepSeries, labelStep, valueDomain, type TrendPoint } from './charts'
import { axisTicks, BlockError, Card, ChartTooltip, EmptyNote, Field, inputClass, Loading, tickLabel } from './ui'
import { useRemote } from './useRemote'
import { useWidth } from './useWidth'

type Props = {
  items: Item[]
  itemId: number | null
  onItemChange: (itemId: number | null) => void
  period: PeriodSelection
  periodKey: string
  refreshToken: string
  onForbidden: () => void
}

/** H: historia zapasu wybranego towaru — pobierana dopiero po wyborze. */
export default function StockTrend({ items, itemId, onItemChange, period, periodKey, refreshToken, onForbidden }: Props) {
  const remote = useRemote<StockTrendResponse>(
    itemId === null ? null : (signal) => fetchTrend(itemId, period, signal),
    JSON.stringify({ itemId, periodKey }),
    refreshToken,
    onForbidden,
  )
  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  const data = remote.data

  return (
    <Card title="Historia zapasu" subtitle="Stan towaru po każdej zapisanej zmianie w wybranym okresie." busy={remote.loading}>
      <Field label="Towar" className="max-w-sm">
        <select
          value={itemId === null ? '' : String(itemId)}
          onChange={(event) => onItemChange(event.target.value ? Number(event.target.value) : null)}
          className={inputClass}
        >
          <option value="">Wybierz towar…</option>
          {sortedItems.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>

      {itemId === null && <EmptyNote>Wybierz towar, aby zobaczyć historię jego zapasu.</EmptyNote>}
      {itemId !== null && remote.error !== null && (
        <BlockError error={remote.error} fallback="Nie udało się pobrać historii zapasu." onRetry={remote.retry} kept={Boolean(data)} />
      )}
      {itemId !== null && !data && remote.loading && <Loading text="Pobieram historię zapasu…" rows={4} />}
      {data && <TrendView data={data} dimmed={remote.loading} fetchedAt={remote.fetchedAt} />}
    </Card>
  )
}

function Reading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-caps">{label}</dt>
      <dd className="mt-1.5 flex items-center gap-3">{children}</dd>
    </div>
  )
}

function Known({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-base text-mute">nieznany</span>
  ) : (
    <span className="text-xl font-semibold leading-none tabular-nums text-ink">{value}</span>
  )
}

function TrendView({ data, dimmed, fetchedAt }: { data: StockTrendResponse; dimmed: boolean; fetchedAt: number | null }) {
  const { item, quality, range } = data
  const zone = range.timezone
  const level = STOCK_LEVEL[stockLevel(item.quantity, item.minimum)]
  const deviates = level.kind !== 'idle'
  const notes: { text: string; tone: 'warn' | 'info' }[] = []
  if (!quality.opening_known) notes.push({ text: 'Brak znanego stanu na początku zakresu.', tone: 'info' })
  if (quality.continuity_warnings > 0) {
    notes.push({
      text: `Luki w historii: ${quality.continuity_warnings} (stan przed operacją różni się od poprzedniego zapisu — zmiana poza audytem).`,
      tone: 'warn',
    })
  }
  if (quality.current_matches_latest_audit === false) {
    notes.push({ text: `Obecny stan (${item.quantity} ${item.unit}) różni się od ostatniego wpisu audytu.`, tone: 'warn' })
  }
  if (quality.current_matches_latest_audit === null) notes.push({ text: 'Ten towar nie ma jeszcze żadnego wpisu audytu.', tone: 'info' })
  if (quality.unit_is_current) notes.push({ text: `Nazwa, jednostka (${item.unit}) i minimum są bieżące — historia jednostek nie jest zapisywana.`, tone: 'info' })

  return (
    <div className={'space-y-5 transition-opacity duration-200 ' + (dimmed ? 'opacity-60' : '')}>
      <div className="border-t border-line pt-5">
        <p className="text-[15px] font-semibold text-ink">
          {item.name} <span className="font-normal text-ink-2">· {formatRange(range)}</span>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 @2xl:grid-cols-[auto_auto_auto_auto] @2xl:justify-start @2xl:gap-x-10">
          <Reading label="Teraz">
            <span className={'flex items-center gap-1.5 text-xl font-semibold leading-none tabular-nums ' + (deviates ? stateTextClass(level.kind) : 'text-ink')}>
              {deviates && <StateShape kind={level.kind} />}
              {item.quantity}
              <span className="text-sm font-normal text-ink-2">{item.unit}</span>
              {deviates && <span className="sr-only"> — {level.label}</span>}
            </span>
            <RangeIndicator value={item.quantity} minimum={item.minimum} label={item.name} unit={item.unit} size="sm" className="w-28" />
          </Reading>
          <Reading label="Minimum">
            <span className="text-xl font-semibold leading-none tabular-nums text-ink">{item.minimum}</span>
          </Reading>
          <Reading label="Na początku zakresu">
            <Known value={data.opening_quantity} />
          </Reading>
          <Reading label="Na końcu">
            <Known value={data.closing_quantity} />
          </Reading>
        </dl>
      </div>

      {data.points.length === 0 && data.opening_quantity === null ? (
        <EmptyNote>Brak zapisów zapasu tego towaru w wybranym okresie.</EmptyNote>
      ) : (
        <StepChart data={data} fetchedAt={fetchedAt} />
      )}
      {data.points.length === 0 && data.opening_quantity !== null && <p className="text-sm text-ink-2">W wybranym okresie stan się nie zmieniał.</p>}

      {notes.length > 0 && (
        <ul className="space-y-1.5 text-[13px]">
          {notes.map((note) => (
            <li key={note.text} className={'flex items-start gap-2 ' + (note.tone === 'warn' ? 'font-medium text-warn-ink' : 'text-ink-2')}>
              <StateShape kind={note.tone === 'warn' ? 'warn' : 'idle'} size={9} className="mt-[4px]" />
              <span className="min-w-0">{note.text}</span>
            </li>
          ))}
        </ul>
      )}

      {data.points.length > 0 && (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-semibold text-ink-2 transition-colors duration-150 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronIcon size={14} className="transition-transform duration-150 group-open:rotate-90" />
            Lista zdarzeń <span className="font-medium tabular-nums text-mute">({data.points.length})</span>
          </summary>
          <ol className="mt-3 max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
            {[...data.points].reverse().map((point) => (
              <li key={point.audit_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="narrow w-28 shrink-0 text-[13px] tabular-nums text-ink-2">{formatDateTime(point.ts, zone)}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {point.before} → {point.after}
                </span>
                <span className="text-[13px] text-ink-2">
                  {eventLabel(point.event_type)} · <span className="narrow tabular-nums text-mute">#{point.audit_id}</span>
                </span>
                <PointBadges point={point} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}

const BADGE = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold'

function PointBadges({ point }: { point: TrendPoint }) {
  return (
    <>
      {point.undo_of !== null && (
        <span className={`${BADGE} bg-act-soft text-act-ink`}>
          <UndoIcon size={12} />
          korekta <span className="narrow tabular-nums">#{point.undo_of}</span>
        </span>
      )}
      {point.undone_by !== null && <span className={`${BADGE} bg-rail text-ink-2`}>cofnięty</span>}
      {!point.continuous && (
        <span className={`${BADGE} bg-warn-soft text-warn-ink`}>
          <StateShape kind="warn" size={8} />
          luka
        </span>
      )}
    </>
  )
}

function pointFlags(point: TrendPoint): string[] {
  return [
    point.undo_of !== null ? `korekta cofająca wpis #${point.undo_of}` : '',
    point.undone_by !== null ? `cofnięty wpisem #${point.undone_by}` : '',
    point.continuous ? '' : 'luka: stan przed nie zgadza się z poprzednim zapisem',
  ].filter(Boolean)
}

function svgId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '')
}

/** Romb (korekta) o „promieniu” r. */
function diamond(cx: number, cy: number, r: number): string {
  return `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`
}

/** `fetchedAt` — chwila pobrania: dzisiejszy zakres kończy się na „teraz”, nie o północy. */
function StepChart({ data, fetchedAt }: { data: StockTrendResponse; fetchedAt: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const baseId = svgId(useId())
  const areaId = `trend-area-${baseId}`
  const hatchId = `trend-hatch-${baseId}`
  const zone = data.range.timezone
  const startMs = zonedDayStart(data.range.from, zone) ?? Date.parse(`${data.range.from}T00:00:00Z`)
  const dayAfter = zonedDayStart(addDays(data.range.to, 1), zone) ?? startMs + 86_400_000
  const endMs = Math.max(startMs + 60_000, Math.min(dayAfter, fetchedAt ?? dayAfter))
  const opening = data.quality.opening_known ? data.opening_quantity : null
  const { segments, gaps } = buildStepSeries(data.points, opening, startMs, endMs)
  const domain = valueDomain([
    ...segments.flatMap((segment) => segment.map((vertex) => vertex.v)),
    ...gaps.flatMap((gap) => [gap.from, gap.to]),
    data.item.minimum,
  ])

  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null
  const lastVertex = lastSegment && lastSegment.length > 0 ? lastSegment[lastSegment.length - 1] : null
  const endText = lastVertex ? tickLabel(lastVertex.v) : ''

  const height = 248
  const margin = { top: 16, right: lastVertex ? Math.max(24, endText.length * 7.5 + 14) : 12, bottom: 28, left: 40 }
  const plotW = Math.max(40, width - margin.left - margin.right)
  const plotH = height - margin.top - margin.bottom
  const x = (t: number) => margin.left + ((t - startMs) / (endMs - startMs)) * plotW
  const y = (v: number) => margin.top + plotH - ((v - domain.min) / (domain.max - domain.min || 1)) * plotH
  const floor = y(domain.min)
  const ticks = axisTicks(domain.min, domain.max, 4)
  const minimumY = y(data.item.minimum)

  // oś czasu: godziny dla jednego dnia, dni dla dłuższego zakresu
  const timeTicks: { t: number; label: string }[] = []
  if (data.range.from === data.range.to) {
    // krok godzinowy dobrany do długości okna (dzisiejszy zakres kończy się „teraz”)
    const hours = new Intl.DateTimeFormat('pl-PL', { timeZone: zone, hour: '2-digit', minute: '2-digit' })
    const spanMinutes = (endMs - startMs) / 60_000
    const maxTicks = Math.max(2, Math.floor(plotW / 72))
    const stepMinutes = [15, 30, 60, 120, 180, 360].find((step) => spanMinutes / step <= maxTicks) ?? 360
    for (let minute = 0; minute <= spanMinutes; minute += stepMinutes) {
      const t = startMs + minute * 60_000
      timeTicks.push({ t, label: hours.format(new Date(t)) })
    }
  } else {
    const days: string[] = []
    for (let day = data.range.from; day <= data.range.to && days.length < 400; day = addDays(day, 1)) days.push(day)
    const step = labelStep(days.length, Math.max(2, Math.floor(plotW / 64)))
    days.forEach((day, index) => {
      if (index % step !== 0) return
      const t = zonedDayStart(day, zone)
      if (t !== null && t >= startMs && t <= endMs) timeTicks.push({ t, label: formatDay(day) })
    })
  }

  const marks = data.points
    .map((point) => ({ point, cx: x(Math.min(Math.max(Date.parse(point.ts), startMs), endMs)), cy: y(point.after) }))
    .sort((a, b) => a.cx - b.cx)
  const current = active === null ? null : marks[active] ?? null
  const currentGap = current ? gaps.find((gap) => gap.auditId === current.point.audit_id) ?? null : null

  const path = (segment: { t: number; v: number }[]) =>
    segment.map((vertex, at) => `${at === 0 ? 'M' : 'L'}${x(vertex.t).toFixed(1)},${y(vertex.v).toFixed(1)}`).join(' ')

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (marks.length === 0) return
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left
    let best = 0
    for (let index = 1; index < marks.length; index++) {
      if (Math.abs(marks[index].cx - px) < Math.abs(marks[best].cx - px)) best = index
    }
    setActive(best)
  }

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (marks.length === 0) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    setActive((value) => {
      const last = marks.length - 1
      if (event.key === 'Home') return 0
      if (event.key === 'End') return last
      if (value === null) return last
      return Math.min(last, Math.max(0, value + (event.key === 'ArrowRight' ? 1 : -1)))
    })
  }

  const anchorFor = (px: number) => (px < margin.left + 18 ? 'start' : px > margin.left + plotW - 18 ? 'end' : 'middle')

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={marks.length > 0 ? 0 : undefined}
        aria-label={`Wykres schodkowy zapasu: ${data.item.name}, ${data.points.length} zdarzeń, obecne minimum ${data.item.minimum} ${data.item.unit}.${marks.length > 0 ? ' Strzałki w lewo i w prawo pokazują kolejne zdarzenia.' : ''}`}
        className="block max-w-full rounded-sm"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((value) => value ?? (marks.length > 0 ? marks.length - 1 : null))}
        onBlur={() => setActive(null)}
      >
        <defs>
          <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-act)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-act)" stopOpacity="0.02" />
          </linearGradient>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-band" strokeWidth="1.25" />
          </pattern>
        </defs>

        {/* strefa poniżej minimum: kreskowanie jak we wskaźniku zakresu */}
        {data.item.minimum > domain.min && (
          <rect x={margin.left} y={minimumY} width={plotW} height={Math.max(0, floor - minimumY)} fill={`url(#${hatchId})`} opacity={0.7} />
        )}

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={margin.left + plotW} y1={y(tick)} y2={y(tick)} className={tick === domain.min ? 'stroke-line-strong' : 'stroke-line'} />
            <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" className="fill-mute tabular-nums">
              {tickLabel(tick)}
            </text>
          </g>
        ))}

        {timeTicks.map((tick) => (
          <g key={tick.t}>
            <line x1={x(tick.t)} x2={x(tick.t)} y1={floor} y2={floor + 4} className="stroke-line-strong" />
            <text x={x(tick.t)} y={height - 8} textAnchor={anchorFor(x(tick.t))} fontSize="11" className="fill-mute tabular-nums">
              {tick.label}
            </text>
          </g>
        ))}

        {segments.map((segment, index) =>
          segment.length > 1 ? (
            <path
              key={`area-${index}`}
              d={`${path(segment)} L${x(segment[segment.length - 1].t).toFixed(1)},${floor.toFixed(1)} L${x(segment[0].t).toFixed(1)},${floor.toFixed(1)} Z`}
              fill={`url(#${areaId})`}
            />
          ) : null,
        )}

        <line
          x1={margin.left}
          x2={margin.left + plotW}
          y1={minimumY}
          y2={minimumY}
          className="stroke-warn"
          strokeWidth="1.5"
          strokeDasharray="6 4"
        />
        <text
          x={margin.left + 6}
          y={minimumY - 6}
          fontSize="11"
          fontWeight="600"
          className="fill-warn-ink stroke-sheet tabular-nums"
          strokeWidth="3"
          paintOrder="stroke"
        >
          Obecne minimum ({data.item.minimum})
        </text>

        {current && (
          <line x1={current.cx} x2={current.cx} y1={margin.top} y2={floor} className="stroke-line-strong" strokeWidth="1" />
        )}

        {segments.map((segment, index) => (
          <path key={index} d={path(segment)} fill="none" className="stroke-act" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {gaps.map((gap) => (
          <g key={`gap-${gap.auditId}`}>
            <line x1={x(gap.t)} x2={x(gap.t)} y1={y(gap.from)} y2={y(gap.to)} className="stroke-warn" strokeWidth="1.5" strokeDasharray="3 3" />
            <circle cx={x(gap.t)} cy={y(gap.to)} r="3.5" className="fill-sheet stroke-warn" strokeWidth="1.75" />
          </g>
        ))}

        {marks.map(({ point, cx, cy }, index) => {
          const on = index === active
          const r = on ? 5 : 3.5
          if (point.undo_of !== null) {
            return <path key={point.audit_id} d={diamond(cx, cy, r + 1)} className="fill-act-ink stroke-sheet" strokeWidth="3" paintOrder="stroke" />
          }
          if (point.undone_by !== null) {
            return <circle key={point.audit_id} cx={cx} cy={cy} r={r} className="fill-sheet stroke-mute" strokeWidth="1.75" />
          }
          return <circle key={point.audit_id} cx={cx} cy={cy} r={r} className="fill-act stroke-sheet" strokeWidth="3" paintOrder="stroke" />
        })}

        {lastVertex && (
          <g>
            <circle cx={x(lastVertex.t)} cy={y(lastVertex.v)} r="3" className="fill-act" />
            <text
              x={x(lastVertex.t) + 8}
              y={y(lastVertex.v) + 4}
              fontSize="12"
              fontWeight="600"
              className="fill-ink stroke-sheet tabular-nums"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {endText}
            </text>
          </g>
        )}
      </svg>

      {current && (
        <ChartTooltip x={current.cx} y={Math.max(margin.top, current.cy - 24)} width={width}>
          <p className="font-semibold text-ink">
            <span className="narrow tabular-nums">#{current.point.audit_id}</span> · {eventLabel(current.point.event_type)}
          </p>
          <p className="mt-0.5 tabular-nums text-ink-2">{formatDateTime(current.point.ts, zone)}</p>
          <p className="mt-1.5 tabular-nums text-ink-2">
            przed <span className="font-semibold text-ink">{current.point.before}</span> → po{' '}
            <span className="font-semibold text-ink">{current.point.after}</span> ({current.point.delta > 0 ? `+${current.point.delta}` : current.point.delta})
          </p>
          {pointFlags(current.point).map((flag) => (
            <p key={flag} className="mt-1 text-ink-2">
              {flag}
            </p>
          ))}
          {currentGap && (
            <p className="mt-1 font-medium text-warn-ink">
              Luka w historii przed wpisem #{currentGap.auditId}: poprzedni zapis {currentGap.from}, przed operacją {currentGap.to}
            </p>
          )}
        </ChartTooltip>
      )}

      <TrendLegend />
    </div>
  )
}

function TrendLegend() {
  const entry = 'inline-flex items-center gap-1.5'
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2" aria-hidden="true">
      <span className={entry}>
        <svg width="10" height="10" viewBox="0 0 10 10" focusable="false">
          <circle cx="5" cy="5" r="3.5" className="fill-act" />
        </svg>
        zmiana
      </span>
      <span className={entry}>
        <svg width="10" height="10" viewBox="0 0 10 10" focusable="false">
          <circle cx="5" cy="5" r="3.4" className="fill-sheet stroke-mute" strokeWidth="1.5" />
        </svg>
        cofnięta
      </span>
      <span className={entry}>
        <svg width="10" height="10" viewBox="0 0 10 10" focusable="false">
          <path d={diamond(5, 5, 4.2)} className="fill-act-ink" />
        </svg>
        korekta (cofnięcie)
      </span>
      <span className={entry}>
        <svg width="10" height="10" viewBox="0 0 10 10" focusable="false">
          <circle cx="5" cy="5" r="3.4" className="fill-sheet stroke-warn" strokeWidth="1.5" />
        </svg>
        luka w historii
      </span>
      <span className={entry}>
        <svg width="18" height="10" viewBox="0 0 18 10" focusable="false">
          <path d="M0 5h5M8 5h5M16 5h2" className="stroke-warn" strokeWidth="1.5" />
        </svg>
        obecne minimum
      </span>
    </div>
  )
}
