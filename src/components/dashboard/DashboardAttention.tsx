import type { DashboardResponse } from '@/lib/dashboard'
import { formatDay } from '@/lib/dashboardApi'
import type { SectionId } from '@/lib/sections'
import { cardClass, EmptyNote } from './ui'

type Draft = DashboardResponse['attention']['pending_drafts'][number]

const PRIORITY_BADGE: Record<Draft['waiting_priority'], { className: string; label: string }> = {
  normal: { className: 'bg-[#f0efe9] text-[#646b64]', label: 'Oczekuje krócej niż dobę' },
  warning: { className: 'bg-[#fbf3db] text-[#805c12]', label: 'Oczekuje co najmniej dobę' },
  critical: { className: 'bg-[#fdebec] text-[#8f3936]', label: 'Oczekuje co najmniej 2 doby' },
}

const linkButton =
  'shrink-0 text-xs font-semibold text-[#315b37] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]'

function waitingLabel(hours: number): string {
  if (hours < 1) return 'mniej niż godzinę'
  if (hours < 48) return `${Math.floor(hours)} h`
  return `${Math.floor(hours / 24)} dni`
}

function Shown({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null
  return (
    <p className="mt-2 text-xs text-[#70756f]">
      Wyświetlono {shown} z {total}.
    </p>
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
    <section className={cardClass} aria-labelledby="dash-attention">
      <h2 id="dash-attention" className="text-lg font-bold">Wymaga uwagi</h2>
      <p className="mt-1 text-sm text-[#646b64]">Stan teraz. Decyzje o zamówieniach podejmujesz w Kolejce zatwierdzeń.</p>
      <div className="mt-4 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-bold">Poniżej minimum</h3>
            <button type="button" onClick={() => onNavigate('stany')} className={linkButton}>Stany</button>
          </div>
          {attention.below_minimum.length === 0 ? (
            <EmptyNote>Wszystkie towary mają zapas co najmniej na poziomie minimum.</EmptyNote>
          ) : (
            <ul className="mt-3 divide-y divide-[#f0efe9] border border-[#e8e5de]">
              {attention.below_minimum.map((item) => (
                <li key={item.item_id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" title={item.item_name}>{item.item_name}</p>
                    <p className={'text-xs ' + (item.quantity <= 0 ? 'font-semibold text-[#8f3936]' : 'text-[#646b64]')}>
                      {item.quantity} / min. {item.minimum} {item.unit}
                    </p>
                  </div>
                  {item.pending_draft_id !== null ? (
                    <button type="button" onClick={() => onNavigate('kolejka')} className={linkButton}>
                      Szkic #{item.pending_draft_id} w Kolejce
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-[#70756f]">bez szkicu</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Shown shown={attention.below_minimum.length} total={current.below_minimum} />
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-bold">Najstarsze szkice zamówień</h3>
            <button type="button" onClick={() => onNavigate('kolejka')} className={linkButton}>Kolejka</button>
          </div>
          {attention.pending_drafts.length === 0 ? (
            <EmptyNote>Brak szkiców czekających na decyzję.</EmptyNote>
          ) : (
            <ul className="mt-3 divide-y divide-[#f0efe9] border border-[#e8e5de]">
              {attention.pending_drafts.map((draft) => {
                const badge = PRIORITY_BADGE[draft.waiting_priority] ?? PRIORITY_BADGE.normal
                return (
                  <li key={draft.id} className="p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 flex-1 truncate font-semibold" title={draft.item_name}>{draft.item_name}</p>
                      <span className={`shrink-0 px-2 py-0.5 text-xs font-bold ${badge.className}`} title={badge.label}>
                        czeka {waitingLabel(draft.waiting_hours)}
                        <span className="sr-only"> — {badge.label}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#646b64]">
                      Szkic #{draft.id}: {draft.quantity} {draft.unit} · dostawa {formatDay(draft.deliver_on, { day: 'numeric', month: 'short' })}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-[#70756f]">
            Czas oczekiwania na decyzję kierownika, nie opóźnienie dostawy.
            {current.pending_drafts > attention.pending_drafts.length &&
              ` Wyświetlono ${attention.pending_drafts.length} z ${current.pending_drafts}.`}
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-bold">Bez lokalizacji</h3>
            <button type="button" onClick={() => onNavigate('stany')} className={linkButton}>Stany</button>
          </div>
          {attention.missing_location.length === 0 ? (
            <EmptyNote>Każdy towar ma zapisaną lokalizację.</EmptyNote>
          ) : (
            <ul className="mt-3 divide-y divide-[#f0efe9] border border-[#e8e5de]">
              {attention.missing_location.map((item) => (
                <li key={item.item_id} className="truncate p-3 text-sm font-semibold" title={item.item_name}>
                  {item.item_name}
                </li>
              ))}
            </ul>
          )}
          <Shown shown={attention.missing_location.length} total={current.missing_location} />
        </div>
      </div>
    </section>
  )
}
