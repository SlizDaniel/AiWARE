import type { ReactNode } from 'react'
import type { DashboardResponse } from '@/lib/dashboard'
import { formatDay } from '@/lib/dashboardApi'
import type { SectionId } from '@/lib/sections'
import { ChevronIcon } from '../ui/icons'
import RangeIndicator from '../ui/RangeIndicator'
import { StateMark, StateShape, stateTextClass, type StateKind } from '../ui/StateMark'
import { STOCK_LEVEL, stockLevel } from '../ui/stockLevel'
import { buttonClass } from '../ui/styles'
import { Card, EmptyNote } from './ui'

type Draft = DashboardResponse['attention']['pending_drafts'][number]

// Czas oczekiwania: kolor dopiero od doby (odchylenie), poniżej doby spokojny grafit.
const PRIORITY: Record<Draft['waiting_priority'], { kind: StateKind | null; label: string }> = {
  normal: { kind: null, label: 'Oczekuje krócej niż dobę' },
  warning: { kind: 'warn', label: 'Oczekuje co najmniej dobę' },
  critical: { kind: 'alarm', label: 'Oczekuje co najmniej 2 doby' },
}

const ghostLink = buttonClass('ghost', 'sm') + ' -mr-3'

function waitingLabel(hours: number): string {
  if (hours < 1) return 'mniej niż godzinę'
  if (hours < 48) return `${Math.floor(hours)} h`
  return `${Math.floor(hours / 24)} dni`
}

function Shown({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null
  return (
    <p className="mt-3 text-xs text-mute">
      Wyświetlono {shown} z {total}.
    </p>
  )
}

function GroupHeader({ title, count, action }: { title: string; count: number; action: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
        {title}
        <span className="text-sm font-medium tabular-nums text-mute">{count}</span>
      </h3>
      {action}
    </div>
  )
}

/** E: braki, najstarsze szkice, brakujące lokalizacje — stan teraz; decyzje tylko w Kolejce. */
export default function DashboardAttention({
  data,
  onNavigate,
}: {
  data: DashboardResponse
  onNavigate: (section: SectionId) => void
}) {
  const { attention, current } = data
  return (
    <Card title="Wymaga uwagi" subtitle="Stan teraz. Decyzje o zamówieniach podejmujesz w Kolejce zatwierdzeń." flush>
      <div className="mt-5 grid border-t border-line @4xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* lista odchyleń: wskaźnik zakresu przy każdej pozycji */}
        <div className="min-w-0 px-6 py-5">
          <GroupHeader
            title="Poniżej minimum"
            count={current.below_minimum}
            action={
              <button type="button" onClick={() => onNavigate('stany')} className={ghostLink}>
                Stany
                <ChevronIcon size={14} />
              </button>
            }
          />
          {attention.below_minimum.length === 0 ? (
            <div className="mt-3">
              <EmptyNote>Wszystkie towary mają zapas co najmniej na poziomie minimum.</EmptyNote>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {attention.below_minimum.map((item) => {
                const level = stockLevel(item.quantity, item.minimum)
                const state = STOCK_LEVEL[level]
                return (
                  <li key={item.item_id} className="py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-[15px] font-semibold text-ink" title={item.item_name}>
                        {item.item_name}
                      </p>
                      <StateMark kind={state.kind} className="shrink-0">
                        {state.label}
                      </StateMark>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <RangeIndicator value={item.quantity} minimum={item.minimum} label={item.item_name} unit={item.unit} size="sm" className="w-36 shrink-0" />
                      <p className="text-sm tabular-nums text-ink-2">
                        <span className={'font-semibold ' + stateTextClass(state.kind)}>{item.quantity}</span> / min. {item.minimum} {item.unit}
                      </p>
                      <span className="ml-auto">
                        {item.pending_draft_id !== null ? (
                          <button type="button" onClick={() => onNavigate('kolejka')} className={ghostLink}>
                            <StateShape kind="decision" size={8} />
                            <span>
                              Szkic <span className="narrow tabular-nums">#{item.pending_draft_id}</span> w Kolejce
                            </span>
                          </button>
                        ) : (
                          <span className="text-xs text-mute">bez szkicu</span>
                        )}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <Shown shown={attention.below_minimum.length} total={current.below_minimum} />
        </div>

        <div className="min-w-0 divide-y divide-line border-t border-line @4xl:border-l @4xl:border-t-0">
          <div className="px-6 py-5">
            <GroupHeader
              title="Najstarsze szkice zamówień"
              count={current.pending_drafts}
              action={
                <button type="button" onClick={() => onNavigate('kolejka')} className={ghostLink}>
                  Kolejka
                  <ChevronIcon size={14} />
                </button>
              }
            />
            {attention.pending_drafts.length === 0 ? (
              <div className="mt-3">
                <EmptyNote>Brak szkiców czekających na decyzję.</EmptyNote>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {attention.pending_drafts.map((draft) => {
                  const priority = PRIORITY[draft.waiting_priority] ?? PRIORITY.normal
                  return (
                    <li key={draft.id} className="flex items-start gap-3 py-3">
                      <StateShape kind="decision" className="mt-[7px]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 truncate text-[15px] font-semibold text-ink" title={draft.item_name}>
                            {draft.item_name}
                          </p>
                          <span className="shrink-0" title={priority.label}>
                            {priority.kind ? (
                              <StateMark kind={priority.kind}>czeka {waitingLabel(draft.waiting_hours)}</StateMark>
                            ) : (
                              <span className="text-[13px] font-medium text-ink-2">czeka {waitingLabel(draft.waiting_hours)}</span>
                            )}
                            <span className="sr-only"> — {priority.label}</span>
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-ink-2">
                          Szkic <span className="narrow tabular-nums">#{draft.id}</span>: <span className="tabular-nums">{draft.quantity}</span> {draft.unit} · dostawa{' '}
                          {formatDay(draft.deliver_on, { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-mute">
              Czas oczekiwania na decyzję kierownika, nie opóźnienie dostawy.
              {current.pending_drafts > attention.pending_drafts.length &&
                ` Wyświetlono ${attention.pending_drafts.length} z ${current.pending_drafts}.`}
            </p>
          </div>

          <div className="px-6 py-5">
            <GroupHeader
              title="Bez lokalizacji"
              count={current.missing_location}
              action={
                <button type="button" onClick={() => onNavigate('stany')} className={ghostLink}>
                  Stany
                  <ChevronIcon size={14} />
                </button>
              }
            />
            {attention.missing_location.length === 0 ? (
              <div className="mt-3">
                <EmptyNote>Każdy towar ma zapisaną lokalizację.</EmptyNote>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {attention.missing_location.map((item) => (
                  <li key={item.item_id} className="flex items-center gap-3 py-2.5">
                    <StateShape kind="near" />
                    <span className="min-w-0 truncate text-sm font-semibold text-ink" title={item.item_name}>
                      {item.item_name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Shown shown={attention.missing_location.length} total={current.missing_location} />
          </div>
        </div>
      </div>
    </Card>
  )
}
