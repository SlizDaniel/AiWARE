import type { Item } from '@/lib/api'
import type { StockTrendResponse } from '@/lib/dashboard'
import { addDays, eventLabel, fetchTrend, formatDateTime, formatDay, formatRange, zonedDayStart, type PeriodSelection } from '@/lib/dashboardApi'
import { buildStepSeries, valueDomain, type TrendPoint } from './charts'
import { BlockError, Card, EmptyNote, inputClass, labelClass, Loading } from './ui'
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
    <Card
      title="Historia zapasu"
      subtitle="Stan towaru po każdej zapisanej zmianie w wybranym okresie."
      busy={remote.loading}
    >
      <label className={labelClass + ' mt-4 block max-w-sm'}>
        Towar
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
      </label>

      {itemId === null && <EmptyNote>Wybierz towar, aby zobaczyć historię jego zapasu.</EmptyNote>}
      {itemId !== null && remote.error !== null && (
        <BlockError error={remote.error} fallback="Nie udało się pobrać historii zapasu." onRetry={remote.retry} kept={Boolean(data)} />
      )}
      {itemId !== null && !data && remote.loading && <Loading text="Pobieram historię zapasu…" />}
      {data && <TrendView data={data} dimmed={remote.loading} fetchedAt={remote.fetchedAt} />}
    </Card>
  )
}

function TrendView({ data, dimmed, fetchedAt }: { data: StockTrendResponse; dimmed: boolean; fetchedAt: number | null }) {
  const { item, quality, range } = data
  const zone = range.timezone
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
    <div className={'mt-4 ' + (dimmed ? 'opacity-60' : '')}>
      <p className="text-sm text-[#454b46]">
        <span className="font-semibold">{item.name}</span> · teraz {item.quantity} {item.unit} · minimum {item.minimum} · {formatRange(range)}
      </p>
      <p className="mt-1 text-xs text-[#70756f]">
        Na początku zakresu: {data.opening_quantity ?? 'nieznany'} · na końcu: {data.closing_quantity ?? 'nieznany'}
      </p>
      {data.points.length === 0 && data.opening_quantity === null ? (
        <EmptyNote>Brak zapisów zapasu tego towaru w wybranym okresie.</EmptyNote>
      ) : (
        <StepChart data={data} fetchedAt={fetchedAt} />
      )}
      {data.points.length === 0 && data.opening_quantity !== null && (
        <p className="mt-2 text-sm text-[#646b64]">W wybranym okresie stan się nie zmieniał.</p>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {notes.map((note) => (
            <li key={note.text} className={note.tone === 'warn' ? 'font-semibold text-[#805c12]' : 'text-[#70756f]'}>
              {note.text}
            </li>
          ))}
        </ul>
      )}
      {data.points.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-[#315b37]">Lista zdarzeń ({data.points.length})</summary>
          <ol className="mt-2 max-h-72 divide-y divide-[#f0efe9] overflow-y-auto border border-[#e8e5de]">
            {[...data.points].reverse().map((point) => (
              <li key={point.audit_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="text-xs text-[#70756f]">{formatDateTime(point.ts, zone)}</span>
                <span className="font-semibold tabular-nums">
                  {point.before}→{point.after}
                </span>
                <span className="text-xs text-[#646b64]">
                  {eventLabel(point.event_type)} · #{point.audit_id}
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

function PointBadges({ point }: { point: TrendPoint }) {
  return (
    <>
      {point.undo_of !== null && <span className="bg-[#edf0f3] px-1.5 py-0.5 text-xs font-bold text-[#475a70]">korekta #{point.undo_of}</span>}
      {point.undone_by !== null && <span className="bg-[#f0efe9] px-1.5 py-0.5 text-xs font-bold text-[#646b64]">cofnięty</span>}
      {!point.continuous && <span className="bg-[#fbf3db] px-1.5 py-0.5 text-xs font-bold text-[#805c12]">luka</span>}
    </>
  )
}

function pointTitle(point: TrendPoint, zone: string): string {
  const delta = point.delta > 0 ? `+${point.delta}` : String(point.delta)
  const flags = [
    point.undo_of !== null ? `korekta cofająca wpis #${point.undo_of}` : '',
    point.undone_by !== null ? `cofnięty wpisem #${point.undone_by}` : '',
    point.continuous ? '' : 'luka: stan przed nie zgadza się z poprzednim zapisem',
  ].filter(Boolean)
  return [`#${point.audit_id} · ${eventLabel(point.event_type)}`, `${formatDateTime(point.ts, zone)}`, `przed ${point.before} → po ${point.after} (${delta})`, ...flags].join('\n')
}

/** `fetchedAt` — chwila pobrania: dzisiejszy zakres kończy się na „teraz”, nie o północy. */
function StepChart({ data, fetchedAt }: { data: StockTrendResponse; fetchedAt: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>()
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

  const height = 240
  const margin = { top: 14, right: 12, bottom: 26, left: 44 }
  const plotW = Math.max(40, width - margin.left - margin.right)
  const plotH = height - margin.top - margin.bottom
  const x = (t: number) => margin.left + ((t - startMs) / (endMs - startMs)) * plotW
  const y = (v: number) => margin.top + plotH - ((v - domain.min) / (domain.max - domain.min || 1)) * plotH
  const ticks = [domain.min, (domain.min + domain.max) / 2, domain.max]
  const minimumY = y(data.item.minimum)

  return (
    <div ref={ref} className="mt-3 w-full min-w-0">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Wykres schodkowy zapasu: ${data.item.name}, ${data.points.length} zdarzeń, obecne minimum ${data.item.minimum} ${data.item.unit}.`}
        className="block max-w-full"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={margin.left + plotW} y1={y(tick)} y2={y(tick)} stroke="#e8e5de" />
            <text x={margin.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#70756f">
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </text>
          </g>
        ))}
        <line x1={margin.left} x2={margin.left + plotW} y1={minimumY} y2={minimumY} stroke="#b08a2e" strokeDasharray="5 4" />
        <text x={margin.left + 4} y={minimumY - 4} fontSize="11" fill="#805c12">
          Obecne minimum ({data.item.minimum})
        </text>
        {segments.map((segment, index) => (
          <path
            key={index}
            d={segment.map((vertex, at) => `${at === 0 ? 'M' : 'L'}${x(vertex.t).toFixed(1)},${y(vertex.v).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="#315b37"
            strokeWidth="2"
          />
        ))}
        {gaps.map((gap) => (
          <g key={`gap-${gap.auditId}`}>
            <title>{`Luka w historii przed wpisem #${gap.auditId}: poprzedni zapis ${gap.from}, przed operacją ${gap.to}`}</title>
            <line x1={x(gap.t)} x2={x(gap.t)} y1={y(gap.from)} y2={y(gap.to)} stroke="#d8a948" strokeWidth="2" strokeDasharray="3 3" />
            <circle cx={x(gap.t)} cy={y(gap.to)} r="4" fill="#fffaf0" stroke="#d8a948" strokeWidth="2" />
          </g>
        ))}
        {data.points.map((point) => {
          const cx = x(Math.min(Math.max(Date.parse(point.ts), startMs), endMs))
          const cy = y(point.after)
          const undo = point.undo_of !== null
          const undone = point.undone_by !== null
          return (
            <g key={point.audit_id}>
              <title>{pointTitle(point, zone)}</title>
              {undo ? (
                <rect x={cx - 4} y={cy - 4} width="8" height="8" transform={`rotate(45 ${cx} ${cy})`} fill="#475a70" />
              ) : (
                <circle cx={cx} cy={cy} r="4" fill={undone ? '#ffffff' : '#315b37'} stroke={undone ? '#9a9e97' : '#315b37'} strokeWidth="2" />
              )}
              <circle cx={cx} cy={cy} r="10" fill="transparent" />
            </g>
          )
        })}
        <text x={margin.left} y={height - 6} fontSize="11" fill="#70756f">
          {formatDay(data.range.from)}
        </text>
        <text x={margin.left + plotW} y={height - 6} textAnchor="end" fontSize="11" fill="#70756f">
          {formatDay(data.range.to)}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#646b64]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#315b37]" />zmiana</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-2 border-[#9a9e97] bg-white" />cofnięta</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rotate-45 bg-[#475a70]" />korekta (cofnięcie)</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-2 border-[#d8a948] bg-[#fffaf0]" />luka w historii</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[#b08a2e]" />obecne minimum</span>
      </div>
    </div>
  )
}
