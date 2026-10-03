import { useState, type ComponentType } from 'react'
import { ROLE_LABELS, type AuthMode, type CurrentUser } from '@/lib/api'
import { visibleSections, type SectionId } from '@/lib/sections'
import { signOutAndRedirect } from '@/lib/signOut'
import { GaugeIcon, HistoryIcon, LogoutIcon, MapIcon, ProcedureIcon, QueueIcon, SlidersIcon, StockIcon } from './ui/icons'
import { StateShape, type StateKind } from './ui/StateMark'
import { buttonClass } from './ui/styles'

/** Licznik przy pozycji menu: liczba + kształt stanu (np. ▲ 3 poniżej minimum). */
export type NavBadge = { count: number; kind: StateKind; label: string }

type Props = {
  current: SectionId
  onNavigate: (s: SectionId) => void
  connected: boolean
  user: CurrentUser | null
  authMode: AuthMode | null
  /** sekcje kierownika (Dashboard) tylko po potwierdzeniu roli */
  canManage: boolean
  badges?: Partial<Record<SectionId, NavBadge>>
}

const ICONS: Record<SectionId, ComponentType<{ size?: number; className?: string }>> = {
  mapa: MapIcon,
  stany: StockIcon,
  kolejka: QueueIcon,
  historia: HistoryIcon,
  procedury: ProcedureIcon,
  dashboard: GaugeIcon,
  ustawienia: SlidersIcon,
}

export default function Sidebar({ current, onNavigate, connected, user, authMode, canManage, badges = {} }: Props) {
  // Konto i wylogowanie tylko przy logowaniu Supabase (tryb lokalny działa bez kont).
  const account = authMode === 'supabase' && user ? user : null

  return (
    <>
      <aside className="hidden w-60 shrink-0 2xl:w-64 flex-col bg-rail lg:flex">
        <Brand />
        <Navigation current={current} onNavigate={onNavigate} layout="vertical" canManage={canManage} badges={badges} />
        <div className="mt-auto space-y-4 px-4 pb-5">
          {account && <Account user={account} />}
          <ConnectionStatus connected={connected} />
        </div>
      </aside>

      <div className="bg-rail lg:hidden">
        <div className="flex items-center justify-between gap-3 pr-4">
          <Brand compact />
          <ConnectionStatus connected={connected} />
        </div>
        <Navigation current={current} onNavigate={onNavigate} layout="horizontal" canManage={canManage} badges={badges} />
        {account && (
          <div className="border-t border-line px-4 py-2.5">
            <Account user={account} compact />
          </div>
        )}
      </div>
    </>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={'flex items-center gap-3 ' + (compact ? 'px-4 py-3' : 'px-5 pb-7 pt-6')}>
      <img
        src="/brand/mascot.jpg"
        alt="Maskot MAGAZYNIER"
        className={(compact ? 'size-9' : 'size-11') + ' shrink-0 rounded-md bg-sheet object-cover ring-1 ring-line'}
      />
      <div className="min-w-0">
        <div className="text-[15px] font-bold tracking-[0.12em] text-ink [font-variation-settings:'wdth'_112]">MAGAZYNIER</div>
        <div className="mt-0.5 text-xs text-ink-2">Głosowy agent magazynowy</div>
      </div>
    </div>
  )
}

function Navigation({
  current,
  onNavigate,
  layout,
  canManage,
  badges,
}: {
  current: SectionId
  onNavigate: (s: SectionId) => void
  layout: 'vertical' | 'horizontal'
  canManage: boolean
  badges: Partial<Record<SectionId, NavBadge>>
}) {
  const horizontal = layout === 'horizontal'

  return (
    <nav aria-label="Główna nawigacja" className={horizontal ? 'relative flex gap-1 overflow-x-auto px-3 pb-3' : 'space-y-0.5 px-3'}>
      {visibleSections(canManage).map((section) => {
        const Icon = ICONS[section.id]
        const active = current === section.id
        const badge = badges[section.id]
        return (
          <button
            key={section.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(section.id)}
            className={
              'group relative flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-sm font-medium transition-colors duration-150 ' +
              (horizontal ? 'whitespace-nowrap' : 'w-full') +
              (active
                ? ' bg-sheet text-ink shadow-[0_1px_2px_oklch(0.2_0.01_255/0.08)]'
                : ' text-ink-2 hover:bg-sheet/60 hover:text-ink')
            }
          >
            <Icon size={18} className={active ? 'text-act' : 'text-mute group-hover:text-ink-2'} />
            <span className="min-w-0 flex-1 truncate">{section.label}</span>
            {badge && badge.count > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-ink-2" title={badge.label}>
                <StateShape kind={badge.kind} size={8} />
                {badge.count}
                <span className="sr-only">{badge.label}</span>
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

function Account({ user, compact = false }: { user: CurrentUser; compact?: boolean }) {
  const [busy, setBusy] = useState(false)

  const logout = async () => {
    if (busy) return
    setBusy(true)
    await signOutAndRedirect()
  }

  const name = user.display_name || user.email

  return (
    <div className={compact ? 'flex items-center justify-between gap-3' : 'rounded-lg bg-sheet/70 p-3'}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold uppercase text-sheet"
        >
          {name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink" title={user.email}>{name}</div>
          <div className="text-xs text-ink-2">{ROLE_LABELS[user.role] ?? user.role}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        className={buttonClass('ghost', 'sm') + (compact ? '' : ' mt-2 w-full justify-start px-2')}
      >
        <LogoutIcon size={16} />
        {busy ? 'Wylogowuję…' : 'Wyloguj'}
      </button>
    </div>
  )
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-ink-2" aria-live="polite">
      <StateShape kind={connected ? 'ok' : 'alarm'} size={8} />
      {connected ? 'Połączono z serwerem' : 'Brak połączenia'}
    </p>
  )
}
