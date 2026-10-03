import { useState, type ReactNode } from 'react'
import type { Me } from '@/lib/api'
import { signOutAndRedirect } from '@/lib/signOut'

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0] px-4 py-10 text-[#292d2b]">
      <div className="w-full max-w-md border border-[#e8e5de] bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <img src="/brand/mascot.jpg" alt="Maskot MAGAZYNIER" className="h-11 w-11 shrink-0 border border-[#e8e5de] bg-white object-cover" />
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-[0.09em]">MAGAZYNIER</div>
            <div className="mt-0.5 text-xs text-[#777b74]">Głosowy agent magazynowy</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Krótko po wejściu: czekamy na /api/me, zanim pobierzemy dane i włączymy mikrofon. */
export function StartupScreen() {
  return (
    <Frame>
      <p className="mt-6 text-sm text-[#646b64]" role="status">
        Sprawdzam konto…
      </p>
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
      <h1 className="mt-6 text-xl font-bold">Konto czeka na zatwierdzenie</h1>
      <p className="mt-2 text-sm leading-6 text-[#454b46]">
        Konto czeka na zatwierdzenie przez kierownika. Poproś kierownika o nadanie roli w Ustawieniach → Użytkownicy.
      </p>
      {user && (
        <p className="mt-3 break-words text-xs text-[#70756f]">
          Zalogowano jako: {user.display_name || user.email}
          {user.display_name && user.email ? ` (${user.email})` : ''}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="bg-[#292d2b] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#454b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
        >
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
            className="border border-[#d8d6cf] bg-white px-5 py-3 text-sm font-semibold text-[#454b46] transition-colors hover:bg-[#f0efe9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {signingOut ? 'Wylogowuję…' : 'Wyloguj'}
          </button>
        )}
      </div>
      {checked && !checking && (
        <p className="mt-4 text-sm text-[#805c12]" role="status">
          Konto nadal czeka na zatwierdzenie.
        </p>
      )}
    </Frame>
  )
}
