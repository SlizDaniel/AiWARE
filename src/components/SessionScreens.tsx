import { useState, type ReactNode } from 'react'
import type { Me } from '@/lib/api'
import { signOutAndRedirect } from '@/lib/signOut'
import { LogoutIcon, RefreshIcon } from './ui/icons'
import { StateShape } from './ui/StateMark'
import { buttonClass, panelClass } from './ui/styles'

/** Maskotka + znak MAGAZYNIER (jak w pasku nawigacji) — nagłówek ekranów sesji i logowania. */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-3.5">
      <img
        src="/brand/mascot.jpg"
        alt="Maskot MAGAZYNIER"
        width={48}
        height={48}
        className="size-12 shrink-0 rounded-md bg-sheet object-cover ring-1 ring-line"
      />
      <div className="min-w-0">
        <div className="text-base font-bold tracking-[0.12em] text-ink [font-variation-settings:'wdth'_112]">MAGAZYNIER</div>
        <div className="mt-0.5 text-[13px] text-ink-2">Głosowy agent magazynowy</div>
      </div>
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-4 py-10 text-ink">
      <div className={panelClass + ' w-full max-w-md p-6 sm:p-8'}>
        <BrandLockup />
        {children}
      </div>
    </div>
  )
}

/** Krótko po wejściu: czekamy na /api/me, zanim pobierzemy dane i włączymy mikrofon. */
export function StartupScreen({ error = '', onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <Frame>
      {error ? <div className="mt-8 space-y-4 border-t border-line pt-6">
        <p role="alert" className="text-sm text-ink-2">{error}</p>
        <button type="button" onClick={onRetry} className={buttonClass('secondary')}>Spróbuj ponownie</button>
      </div> : <p className="mt-8 flex items-center gap-2.5 border-t border-line pt-6 text-sm text-ink-2" role="status">
        <StateShape kind="idle" className="animate-breathe" />
        Sprawdzam konto…
      </p>}
    </Frame>
  )
}

/** Konto bez roli (oczekujący): żadnych danych, pollingu ani mikrofonu — tylko ponowne sprawdzenie i wylogowanie. */
export function PendingApprovalScreen({ me, onCheck }: { me: Me; onCheck: () => Promise<unknown> }) {
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const user = me.user

  const check = async () => {
    if (checking) return
    setChecking(true)
    try {
      await onCheck()
    } finally {
      setChecking(false)
      setChecked(true)
    }
  }

  return (
    <Frame>
      <div className="mt-8 border-t border-line pt-6">
        <h1 className="flex items-center gap-2.5 text-xl font-semibold leading-snug text-ink">
          <StateShape kind="decision" size={12} />
          Konto czeka na zatwierdzenie
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          Konto czeka na zatwierdzenie przez kierownika. Poproś kierownika o nadanie roli w Ustawieniach → Użytkownicy.
        </p>
        {user && (
          <p className="mt-4 break-words text-[13px] text-mute">
            Zalogowano jako: <span className="font-medium text-ink-2">{user.display_name || user.email}</span>
            {user.display_name && user.email ? ` (${user.email})` : ''}
          </p>
        )}
        <div className="mt-7 flex flex-wrap gap-2.5">
          <button type="button" onClick={() => void check()} disabled={checking} className={buttonClass('primary')}>
            <RefreshIcon size={17} />
            {checking ? 'Sprawdzam…' : 'Sprawdź ponownie'}
          </button>
          {me.auth_mode === 'supabase' && (
            <button
              type="button"
              onClick={() => {
                setSigningOut(true)
                void signOutAndRedirect()
              }}
              disabled={signingOut}
              className={buttonClass('secondary')}
            >
              <LogoutIcon size={17} />
              {signingOut ? 'Wylogowuję…' : 'Wyloguj'}
            </button>
          )}
        </div>
        {checked && !checking && (
          <p className="mt-4 flex items-center gap-2 text-sm font-medium text-act-ink" role="status">
            <StateShape kind="decision" size={8} />
            Konto nadal czeka na zatwierdzenie.
          </p>
        )}
      </div>
    </Frame>
  )
}
