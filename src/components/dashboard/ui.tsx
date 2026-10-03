import { useId, type ReactNode } from 'react'
import { describeError } from '@/lib/dashboardApi'
import { LoadError, RollingNumber, Skeleton } from '../ui/feedback'
import { StateShape, stateTextClass, type StateKind } from '../ui/StateMark'
import { buttonClass, fieldClass, panelClass } from '../ui/styles'

// Słownik dashboardu oparty na wspólnych prymitywach (tokeny, panel, pola, przyciski).
export const cardClass = panelClass
export const labelClass = 'label-caps'
export const secondaryButton = buttonClass('secondary', 'sm')
/** Pole pod etykietą `Field` (odstęp od etykiety w klasie). */
export const inputClass = `${fieldClass} mt-1.5`

/**
 * Blok dashboardu: jeden panel, nagłówek `text-lg` + jednozdaniowy opis. Panel jest kontenerem
 * (`@container`), więc układ w środku zależy od szerokości panelu, nie okna.
 * `flush` — treść bez wewnętrznych marginesów (tabela, pasek odczytów od krawędzi do krawędzi).
 * `fill` — treść rozciąga się na całą wysokość panelu (wykres obok wyższego sąsiada w siatce).
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  busy = false,
  flush = false,
  fill = false,
  className = '',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  busy?: boolean
  flush?: boolean
  fill?: boolean
  className?: string
}) {
  const headingId = useId()
  const body = fill ? 'flex flex-1 flex-col gap-5 px-6 pb-6 pt-5' : 'space-y-5 px-6 pb-6 pt-5'
  return (
    <section className={`${panelClass} @container ${fill ? 'flex flex-col' : ''} ${className}`} aria-busy={busy} aria-labelledby={headingId}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-6">
        <div className="min-w-0 max-w-[68ch]">
          <h2 id={headingId} className="text-lg font-semibold leading-snug text-ink">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {flush ? children : <div className={body}>{children}</div>}
    </section>
  )
}

/** Etykieta nad polem formularza (pole dostaje `inputClass`). */
export function Field({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="label-caps block">{label}</span>
      {children}
    </label>
  )
}

export function Loading({ text = 'Pobieram dane…', rows = 3 }: { text?: string; rows?: number }) {
  return <Skeleton rows={rows} label={text} />
}

/** Cicha notka pustego stanu wewnątrz bloku (bez ramki — blok jest już panelem). */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-md bg-ground px-4 py-3.5 text-sm text-ink-2">
      <StateShape kind="idle" className="mt-[5px]" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Błąd bloku z przyciskiem Ponów. `kept` — obok zostają ostatnie poprawne dane. */
export function BlockError({
  error,
  fallback,
  onRetry,
  kept = false,
}: {
  error: unknown
  fallback: string
  onRetry: () => void
  kept?: boolean
}) {
  return (
    <LoadError
      title={describeError(error, fallback)}
      detail={kept ? 'Poniżej ostatnie poprawnie pobrane dane.' : undefined}
      onRetry={onRetry}
      retryLabel="Ponów"
    />
  )
}

export type ReadoutItem = {
  label: string
  value: number
  note?: ReactNode
  /** kolor i kształt tylko dla odchylenia albo decyzji; `null` = stan normalny (grafit) */
  kind?: StateKind | null
}

/**
 * Pasek odczytów (jak wiersz wartości na ekranie przeglądowym): duże liczby tabelaryczne
 * rozdzielone pionowymi liniami, podpis pod spodem. Od krawędzi do krawędzi panelu.
 */
export function ReadoutRow({ items, className = '' }: { items: ReadoutItem[]; className?: string }) {
  return (
    <dl className={`grid grid-cols-2 @xl:grid-cols-4 ${className}`}>
      {items.map((item, index) => {
        const kind = item.kind ?? null
        const rule =
          (index % 2 === 1 ? ' border-l' : '') +
          (index === 2 ? ' border-t @xl:border-t-0 @xl:border-l' : '') +
          (index === 3 ? ' border-t @xl:border-t-0' : '')
        return (
          <div key={item.label} className={`flex min-w-0 flex-col border-line py-5 pl-6 pr-4${rule}`}>
            <dt className="label-caps order-2 mt-2.5">{item.label}</dt>
            <dd className={`order-1 flex items-center gap-2 text-[28px] font-semibold leading-none tabular-nums ${kind ? stateTextClass(kind) : 'text-ink'}`}>
              {kind && <StateShape kind={kind} size={12} />}
              <RollingNumber value={item.value} />
            </dd>
            {item.note && <dd className="order-3 mt-1 text-xs text-mute">{item.note}</dd>}
          </div>
        )
      })}
    </dl>
  )
}

// --- wykresy -----------------------------------------------------------------------------

/** Podziałka osi od `min` do `max` w krokach całkowitych (najwyżej `maxParts` przedziałów). */
export function axisTicks(min: number, max: number, maxParts = 5): number[] {
  if (min < 0) return [min, 0, max]
  const span = max - min
  for (const parts of [4, 5, 2]) {
    if (parts > maxParts) continue
    const step = span / parts
    if (step > 0 && Number.isInteger(step)) return Array.from({ length: parts + 1 }, (_, index) => min + index * step)
  }
  return [min, max]
}

export function tickLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** Dymek wykresu (hover / fokus klawiatury). Dane są też w tabeli dla czytnika — dymek tylko dla oka. */
export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width / 2
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-10 w-max max-w-64 rounded-md bg-sheet px-3 py-2.5 text-xs text-ink shadow-raise ring-1 ring-line"
      style={{ left: x, top: y, transform: `translateX(${flip ? 'calc(-100% - 14px)' : '14px'})` }}
    >
      {children}
    </div>
  )
}

/** Wiersz dymka: znacznik serii, wartość (mocno), nazwa serii (słabiej). */
export function TooltipRow({ swatch, value, label }: { swatch: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="flex w-3 justify-center">{swatch}</span>
      <span className="min-w-[2ch] text-right font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-ink-2">{label}</span>
    </div>
  )
}
