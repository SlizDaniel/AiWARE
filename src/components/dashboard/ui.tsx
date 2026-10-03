import type { ReactNode } from 'react'
import { describeError } from '@/lib/dashboardApi'

export const cardClass = 'min-w-0 border border-[#e8e5de] bg-white p-5 sm:p-6'
export const labelClass = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-[#70756f]'
export const secondaryButton =
  'border border-[#d8d6cf] bg-white px-3 py-2 text-sm font-semibold text-[#454b46] transition-colors hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40'
export const inputClass =
  'mt-1 block w-full min-w-0 border border-[#d8d6cf] bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#292d2b] focus-visible:border-[#536b56] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]'

export function Card({
  title,
  subtitle,
  actions,
  children,
  busy = false,
  className = '',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  busy?: boolean
  className?: string
}) {
  return (
    <section className={`${cardClass} ${className}`} aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-[#646b64]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Loading({ text = 'Pobieram dane…' }: { text?: string }) {
  return (
    <p className="mt-4 text-sm text-[#646b64]" role="status">
      {text}
    </p>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 border border-dashed border-[#d8d6cf] bg-[#fbfaf7] p-4 text-sm text-[#70756f]">{children}</p>
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
    <div className="mt-4 border border-[#edc8c5] bg-[#fff7f6] p-4 text-sm text-[#8f3936]" role="alert">
      <p className="font-semibold">{describeError(error, fallback)}</p>
      {kept && <p className="mt-1">Poniżej ostatnie poprawnie pobrane dane.</p>}
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
      >
        Ponów
      </button>
    </div>
  )
}

export function Tile({ label, value, note, tone = 'neutral' }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'neutral' | 'warn' | 'bad' | 'good' }) {
  const valueColor = tone === 'bad' ? 'text-[#8f3936]' : tone === 'warn' ? 'text-[#805c12]' : tone === 'good' ? 'text-[#315b37]' : 'text-[#292d2b]'
  return (
    <div className="min-w-0 border border-[#e8e5de] bg-[#fbfaf7] p-4">
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-2 text-2xl font-bold tabular-nums sm:text-3xl ${valueColor}`}>{value}</dd>
      {note && <dd className="mt-1 text-xs text-[#70756f]">{note}</dd>}
    </div>
  )
}
