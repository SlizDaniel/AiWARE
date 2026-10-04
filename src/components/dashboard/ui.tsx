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
 * `bare` — bez własnej powierzchni (blok osadzony w panelu z przełącznikiem — nigdy panel w panelu).
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  busy = false,
  flush = false,
  fill = false,
  bare = false,
  className = '',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  busy?: boolean
  flush?: boolean
  fill?: boolean
  bare?: boolean
  className?: string
}) {
  const headingId = useId()
  const body = fill ? 'flex flex-1 flex-col gap-5 px-6 pb-6 pt-5' : 'space-y-5 px-6 pb-6 pt-5'
  return (
    <section
      className={`${bare ? 'min-w-0' : panelClass} @container ${fill ? 'flex flex-col' : ''} ${className}`}
      aria-busy={busy}
      aria-labelledby={headingId}
    >
      <header className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 ${bare ? 'pt-5' : 'pt-6'}`}>
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

/** Polska odmiana liczebnika: 1 towar, 2–4 towary, 5+ towarów (12–14 towarów). */
export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one
  const tens = count % 100
  const units = count % 10
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many
}

export type ReadoutItem = {
  value: number
  /** słowo po liczbie, już w odpowiedniej formie (np. „towary”, „poniżej minimum”) */
  label: string
  /** krótkie dopowiedzenie w nawiasie, np. „w tym import pozycji: 4” */
  note?: ReactNode
  /** kolor i kształt tylko dla odchylenia albo decyzji; `null` = stan normalny (grafit) */
  kind?: StateKind | null
}

/**
 * Odczyt w jednej linii, jak zdanie: „48 towarów · ▲ 3 poniżej minimum · ◆ 2 oczekujące szkice”.
 * Liczby tabelaryczne i pogrubione, słowa słabiej; kształt i kolor tylko przy odchyleniu.
 */
export function ReadoutLine({ items, className = '' }: { items: ReadoutItem[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 text-sm text-ink-2 ${className}`}>
      {items.map((item, index) => {
        const kind = item.kind ?? null
        return (
          <li key={item.label} className="inline-flex items-baseline gap-1.5">
            {index > 0 && (
              <span aria-hidden="true" className="mr-1 text-mute">
                ·
              </span>
            )}
            {kind && <StateShape kind={kind} className="self-center" />}
            <span className={`text-base font-semibold tabular-nums ${kind ? stateTextClass(kind) : 'text-ink'}`}>
              <RollingNumber value={item.value} />
            </span>
            <span>{item.label}</span>
            {item.note && <span className="text-mute">({item.note})</span>}
          </li>
        )
      })}
    </ul>
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
