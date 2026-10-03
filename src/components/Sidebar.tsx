import { useState } from 'react'
import { ROLE_LABELS, type AuthMode, type CurrentUser } from '@/lib/api'
import { visibleSections, type SectionId } from '@/lib/sections'
import { signOutAndRedirect } from '@/lib/signOut'

type Props = {
  current: SectionId
  onNavigate: (s: SectionId) => void
  connected: boolean
  user: CurrentUser | null
  authMode: AuthMode | null
  /** sekcje kierownika (Dashboard) tylko po potwierdzeniu roli */
  canManage: boolean
}

export default function Sidebar({ current, onNavigate, connected, user, authMode, canManage }: Props) {
  // Konto i wylogowanie tylko przy logowaniu Supabase (tryb lokalny działa bez kont).
  const account = authMode === 'supabase' && user ? user : null

  return (
    <>
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-[#e8e5de] bg-[#fbfaf7] lg:flex">
        <Brand />
        <Navigation current={current} onNavigate={onNavigate} layout="vertical" canManage={canManage} />
        {account && <Account user={account} />}
        <ConnectionStatus connected={connected} />
      </aside>

      <div className="border-b border-[#e8e5de] bg-[#fbfaf7] lg:hidden">
        <Brand compact />
        <Navigation current={current} onNavigate={onNavigate} layout="horizontal" canManage={canManage} />
        {account && <Account user={account} compact />}
      </div>
    </>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={'flex items-center gap-3 ' + (compact ? 'px-4 py-3' : 'px-5 py-6')}>
      <img
        src="/brand/mascot.jpg"
        alt="Maskot MAGAZYNIER"
        className="h-11 w-11 shrink-0 border border-[#e8e5de] bg-white object-cover"
      />
      <div className="min-w-0">
        <div className="text-[15px] font-bold tracking-[0.09em] text-[#292d2b]">MAGAZYNIER</div>
        <div className="mt-0.5 text-xs text-[#777b74]">Głosowy agent magazynowy</div>
      </div>
    </div>
  )
}

function Navigation({
  current,
  onNavigate,
  layout,
  canManage,
}: {
  current: SectionId
  onNavigate: (s: SectionId) => void
  layout: 'vertical' | 'horizontal'
  canManage: boolean
}) {
  const horizontal = layout === 'horizontal'

  return (
    <nav
      aria-label="Główna nawigacja"
      className={horizontal ? 'flex gap-1 overflow-x-auto px-3 pb-3' : 'flex-1 space-y-1 px-3 pt-3'}
    >
      {visibleSections(canManage).map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={current === section.id ? 'page' : undefined}
          onClick={() => onNavigate(section.id)}
          className={
            'shrink-0 border px-3.5 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] ' +
            (horizontal ? 'whitespace-nowrap' : 'w-full') +
            (current === section.id
              ? ' border-[#d8e2d5] bg-[#edf3ec] text-[#315b37]'
              : ' border-transparent text-[#646b64] hover:bg-[#f0efe9] hover:text-[#292d2b]')
          }
        >
          {section.label}
        </button>
      ))}
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
    <div
      className={
        compact
          ? 'flex items-center justify-between gap-3 border-t border-[#e8e5de] px-4 py-2.5'
          : 'border-t border-[#e8e5de] px-5 py-4'
      }
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[#292d2b]" title={user.email}>{name}</div>
        <div className="mt-0.5 text-xs text-[#70756f]">{ROLE_LABELS[user.role] ?? user.role}</div>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        className={
          'shrink-0 border border-[#d8d6cf] bg-white px-3 py-2 text-sm font-semibold text-[#454b46] transition-colors hover:bg-[#f0efe9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40' +
          (compact ? '' : ' mt-3')
        }
      >
        {busy ? 'Wylogowuję…' : 'Wyloguj'}
      </button>
    </div>
  )
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className="border-t border-[#e8e5de] px-5 py-4 text-xs text-[#70756f]" aria-live="polite">
      <span className={'mr-2 inline-block h-2 w-2 rounded-full ' + (connected ? 'bg-[#527b58]' : 'bg-[#a45d52]')} aria-hidden="true" />
      {connected ? 'Połączono z backendem' : 'Brak połączenia'}
      <div className="mt-2 text-[#70756f]">HackYeah 2026 · tracer</div>
    </div>
  )
}
