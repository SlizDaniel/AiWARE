import type { DashboardResponse } from '@/lib/dashboard'
import { formatDay, formatRange } from '@/lib/dashboardApi'
import { labelStep, niceMax } from './charts'
import { cardClass, EmptyNote, Tile } from './ui'
import { useWidth } from './useWidth'

const COLORS = { withdrawals: '#a45d52', receipts: '#527b58', undo: '#9a9e97' }

/** Polska odmiana liczebnika: 1 zmiana, 2–4 zmiany, 5+ zmian (12–14 zmian). */
function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one
  const tens = count % 100
  const units = count % 10
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many
}

/** B: stan teraz. C: wybrany okres. */
export function SummaryTiles({ data }: { data: DashboardResponse }) {
  const { current, period, range } = data
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={cardClass} aria-labelledby="dash-now">
        <h2 id="dash-now" className="text-lg font-bold">Stan teraz</h2>
        <p className="mt-1 text-sm text-[#646b64]">Bieżący stan magazynu — niezależnie od wybranego okresu.</p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <Tile label="Towary" value={current.total_items} />
          <Tile label="Poniżej minimum" value={current.below_minimum} tone={current.below_minimum > 0 ? 'bad' : 'good'} />
          <Tile label="Oczekujące szkice" value={current.pending_drafts} tone={current.pending_drafts > 0 ? 'warn' : 'neutral'} />
          <Tile label="Bez lokalizacji" value={current.missing_location} tone={current.missing_location > 0 ? 'warn' : 'neutral'} />
        </dl>
      </section>
      <section className={cardClass} aria-labelledby="dash-period">
        <h2 id="dash-period" className="text-lg font-bold">W wybranym okresie</h2>
        <p className="mt-1 text-sm text-[#646b64]">
          {formatRange(range)} · strefa {range.timezone}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <Tile label="Pobrania" value={period.withdrawals} note="liczba operacji" />
          <Tile label="Przyjęcia" value={period.receipts} note="liczba operacji" />
          <Tile label="Cofnięcia" value={period.undo_count} note="wpisy korygujące" />
          <Tile label="Wpisy audytu" value={period.audit_events} note={`w tym import pozycji: ${period.import_events}`} />
        </dl>
        <p className="mt-3 text-xs text-[#70756f]">Pobrania i przyjęcia to liczby operacji, nie sztuk — różnych jednostek nie sumujemy.</p>
      </section>
    </div>
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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className={cardClass} aria-labelledby="dash-daily">
        <h2 id="dash-daily" className="text-lg font-bold">Operacje dziennie</h2>
        <p className="mt-1 text-sm text-[#646b64]">Liczba operacji w każdym dniu zakresu (także dni bez operacji).</p>
        <Legend />
        {data.daily.length === 0 ? (
          <EmptyNote>Brak dni w wybranym zakresie.</EmptyNote>
        ) : (
          <DailyChart daily={data.daily} summary={`Razem: pobrania ${totals.w}, przyjęcia ${totals.r}, cofnięcia ${totals.u}.`} />
        )}
      </section>
      <section className={cardClass} aria-labelledby="dash-top">
        <h2 id="dash-top" className="text-lg font-bold">Najczęściej zmieniane</h2>
        <p className="mt-1 text-sm text-[#646b64]">Top 10 towarów według liczby zmian zapasu w okresie.</p>
        {data.most_changed_items.length === 0 ? (
          <EmptyNote>Brak zmian zapasu w wybranym okresie.</EmptyNote>
        ) : (
          <ol className="mt-4 space-y-3">
            {data.most_changed_items.map((item, index) => (
              <li key={`${item.item_id ?? 'x'}-${index}`} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold text-[#292d2b]" title={item.item_name}>
                    {index + 1}. {item.item_name}
                  </span>
                  {item.item_id !== null && (
                    <button
                      type="button"
                      onClick={() => onShowTrend(item.item_id as number)}
                      className="shrink-0 text-xs font-semibold text-[#315b37] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
                    >
                      Historia zapasu
                    </button>
                  )}
                </div>
                <div className="mt-1 h-2 bg-[#f0efe9]" aria-hidden="true">
                  <div className="h-2 bg-[#527b58]" style={{ width: `${(item.stock_changes / topMax) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-[#70756f]">
                  {item.stock_changes} {plural(item.stock_changes, 'zmiana', 'zmiany', 'zmian')} · pobrania {item.withdrawals} · przyjęcia {item.receipts}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#646b64]" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5" style={{ background: COLORS.withdrawals }} />Pobrania</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5" style={{ background: COLORS.receipts }} />Przyjęcia</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5" style={{ background: COLORS.undo }} />Cofnięcia</span>
    </div>
  )
}

function DailyChart({ daily, summary }: { daily: DashboardResponse['daily']; summary: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = 200
  const margin = { top: 10, right: 6, bottom: 26, left: 30 }
  const plotW = Math.max(40, width - margin.left - margin.right)
  const plotH = height - margin.top - margin.bottom
  const max = niceMax(Math.max(...daily.flatMap((day) => [day.withdrawals, day.receipts, day.undo_count])))
  const group = plotW / daily.length
  const bar = Math.max(1, Math.min(14, (group * 0.8) / 3))
  const every = labelStep(daily.length, Math.max(2, Math.floor(plotW / 56)))
  const y = (value: number) => margin.top + plotH - (value / max) * plotH

  return (
    <div ref={ref} className="mt-3 w-full min-w-0">
      <svg width={width} height={height} role="img" aria-label={`Wykres operacji dziennie. ${summary}`} className="block max-w-full">
        {[0, max / 2, max].map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={margin.left + plotW} y1={y(tick)} y2={y(tick)} stroke="#e8e5de" />
            <text x={margin.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#70756f">
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </text>
          </g>
        ))}
        {daily.map((day, index) => {
          const x0 = margin.left + index * group + (group - bar * 3) / 2
          const values = [
            { value: day.withdrawals, color: COLORS.withdrawals },
            { value: day.receipts, color: COLORS.receipts },
            { value: day.undo_count, color: COLORS.undo },
          ]
          return (
            <g key={day.date}>
              <title>
                {`${formatDay(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}: pobrania ${day.withdrawals}, przyjęcia ${day.receipts}, cofnięcia ${day.undo_count}`}
              </title>
              <rect x={margin.left + index * group} y={margin.top} width={group} height={plotH} fill="transparent" />
              {values.map((entry, slot) =>
                entry.value > 0 ? (
                  <rect key={slot} x={x0 + slot * bar} y={y(entry.value)} width={Math.max(1, bar - 1)} height={y(0) - y(entry.value)} fill={entry.color} />
                ) : null,
              )}
              {index % every === 0 && (
                <text x={margin.left + index * group + group / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="#70756f">
                  {formatDay(day.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="mt-1 text-xs text-[#70756f]">{summary}</p>
    </div>
  )
}
