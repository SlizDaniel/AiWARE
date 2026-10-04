import { useState, type ReactNode } from 'react'
import { StateShape, type StateKind } from './StateMark'
import { buttonClass } from './styles'

/**
 * Liczba, która przy zmianie „przewija się” na nowe miejsce (jak tablica Solari):
 * każda zmiana stanu ogłasza się tam, gdzie patrzy człowiek. Pierwszy render bez animacji.
 */
export function RollingNumber({ value, className = '' }: { value: number | string; className?: string }) {
  const [initial] = useState(value)
  return (
    <span className={`inline-flex overflow-hidden align-bottom ${className}`}>
      <span key={String(value)} className={value === initial ? 'inline-block' : 'inline-block animate-roll'}>
        {value}
      </span>
    </span>
  )
}

/** Krótkie podświetlenie tła po zmianie `value` (do wiersza tabeli). Rodzic musi mieć `relative`. */
export function ChangeFlash({ value }: { value: number | string }) {
  const [initial] = useState(value)
  if (value === initial) return null
  return <span key={String(value)} aria-hidden="true" className="pointer-events-none absolute inset-0 animate-flash" />
}

type NoticeTone = 'info' | 'warn' | 'alarm' | 'ok'

const NOTICE: Record<NoticeTone, { box: string; kind: StateKind }> = {
  info: { box: 'bg-act-soft text-act-ink', kind: 'decision' },
  warn: { box: 'bg-warn-soft text-warn-ink', kind: 'warn' },
  alarm: { box: 'bg-alarm-soft text-alarm-ink', kind: 'alarm' },
  ok: { box: 'bg-ok-soft text-ok-ink', kind: 'ok' },
}

/** Komunikat w treści (ostrzeżenie, błąd, potwierdzenie). Kształt + kolor, bez kolorowej krawędzi. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  role,
  className = '',
}: {
  tone?: NoticeTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  role?: 'alert' | 'status'
  className?: string
}) {
  const style = NOTICE[tone]
  return (
    <div className={`flex gap-3 rounded-md px-4 py-3 text-sm ${style.box} ${className}`} role={role}>
      <StateShape kind={style.kind} className="mt-[5px]" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  )
}

/** Błąd pobierania z przyciskiem ponowienia. */
export function LoadError({ title, detail, onRetry, retryLabel = 'Spróbuj ponownie' }: { title: string; detail?: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <Notice
      tone="alarm"
      role="alert"
      title={title}
      action={onRetry && (
        <button type="button" onClick={onRetry} className={buttonClass('danger', 'sm')}>
          {retryLabel}
        </button>
      )}
    >
      {detail}
    </Notice>
  )
}

/** Pusty stan, który uczy, co zrobić dalej. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center" role="status">
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-[52ch] text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Szkielet ładowania: kilka szarych wierszy w miejscu treści. */
export function Skeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-11 animate-pulse rounded-md bg-rail" style={{ opacity: 1 - index * 0.15 }} />
      ))}
    </div>
  )
}
