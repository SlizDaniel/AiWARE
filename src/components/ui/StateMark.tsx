import type { ReactNode } from 'react'

/**
 * Znacznik stanu jak na ekranie operatorskim: kolor i kształt naraz (czytelny także bez rozróżniania barw).
 * alarm = kwadrat (brak, błąd), warn = trójkąt (poniżej minimum), near = pusty trójkąt (blisko minimum),
 * decision = romb (czeka na człowieka), ok = koło pełne (zapisane), idle = koło puste (bez odchyleń).
 */
export type StateKind = 'alarm' | 'warn' | 'near' | 'decision' | 'ok' | 'idle'

const COLOR: Record<StateKind, string> = {
  alarm: 'text-alarm',
  warn: 'text-warn',
  near: 'text-warn',
  decision: 'text-act',
  ok: 'text-ok',
  idle: 'text-mute',
}

const TEXT: Record<StateKind, string> = {
  alarm: 'text-alarm-ink',
  warn: 'text-warn-ink',
  near: 'text-warn-ink',
  decision: 'text-act-ink',
  ok: 'text-ok-ink',
  idle: 'text-ink-2',
}

export function StateShape({ kind, size = 10, className = '' }: { kind: StateKind; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false" className={`shrink-0 ${COLOR[kind]} ${className}`}>
      {kind === 'alarm' && <rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="currentColor" />}
      {kind === 'warn' && <path d="M5 0.6 9.6 9.2H0.4Z" fill="currentColor" strokeLinejoin="round" />}
      {kind === 'near' && <path d="M5 1.6 8.9 8.6H1.1Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />}
      {kind === 'decision' && <path d="M5 0.3 9.7 5 5 9.7 0.3 5Z" fill="currentColor" />}
      {kind === 'ok' && <circle cx="5" cy="5" r="4.4" fill="currentColor" />}
      {kind === 'idle' && <circle cx="5" cy="5" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.4" />}
    </svg>
  )
}

/** Znacznik z podpisem, np. „▲ Poniżej minimum”. */
export function StateMark({ kind, children, className = '' }: { kind: StateKind; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${TEXT[kind]} ${className}`}>
      <StateShape kind={kind} />
      {children}
    </span>
  )
}

/** Klasy tekstu dla danego stanu (do liczb i podpisów poza znacznikiem). */
export function stateTextClass(kind: StateKind): string {
  return TEXT[kind]
}
