'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { BrandLockup } from '@/components/SessionScreens'
import { Notice } from '@/components/ui/feedback'
import { StateShape } from '@/components/ui/StateMark'
import { buttonClass, fieldClass, panelClass, segmentClass, segmentGroupClass } from '@/components/ui/styles'
import { createClient, isSupabaseConfiguredInBrowser } from '@/lib/supabase/client'

type Tab = 'login' | 'signup'

type AuthErrorLike = { code?: string; name?: string; message?: string; status?: number }

const CALLBACK_ERROR =
  'Nie udało się dokończyć logowania z linku (wygasł albo otwarto go w innej przeglądarce). Jeśli był to link potwierdzający, adres jest już potwierdzony — zaloguj się hasłem.'

function describeAuthError(error: AuthErrorLike, tab: Tab): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Nieprawidłowy e-mail lub hasło.'
    case 'email_not_confirmed':
      return 'Adres e-mail nie jest jeszcze potwierdzony — kliknij link z wiadomości wysłanej po rejestracji.'
    case 'user_already_exists':
    case 'email_exists':
      return 'Konto z tym adresem już istnieje — zaloguj się.'
    case 'weak_password':
      return 'Hasło jest za słabe — użyj dłuższego hasła z literami i cyframi.'
    case 'email_address_invalid':
      return 'Ten adres e-mail jest nieprawidłowy.'
    case 'email_address_not_authorized':
      return 'Serwer nie może wysłać wiadomości na ten adres. Użyj innego adresu albo poproś administratora o konfigurację poczty.'
    case 'signup_disabled':
      return 'Zakładanie nowych kont jest wyłączone. Poproś kierownika o dostęp.'
    case 'email_provider_disabled':
      return 'Logowanie adresem e-mail jest wyłączone w ustawieniach Supabase.'
    case 'over_email_send_rate_limit':
      return 'Wysłano zbyt wiele wiadomości e-mail. Spróbuj ponownie za kilka minut.'
    case 'over_request_rate_limit':
      return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.'
    case 'user_banned':
      return 'To konto zostało zablokowane.'
    case 'validation_failed':
      return 'Sprawdź poprawność adresu e-mail i hasła.'
  }
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || /fetch|network/i.test(error.message ?? '')) {
    return 'Brak połączenia z serwerem logowania. Sprawdź internet i spróbuj ponownie.'
  }
  return tab === 'login' ? 'Nie udało się zalogować. Spróbuj ponownie.' : 'Nie udało się założyć konta. Spróbuj ponownie.'
}

export default function LoginForm({ callbackError, next }: { callbackError: string | null; next: string }) {
  return (
    <main className="flex min-h-dvh justify-center bg-ground px-4 py-8 text-ink sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        {isSupabaseConfiguredInBrowser() ? <AuthCard callbackError={callbackError} next={next} /> : <NotConfigured />}
      </div>
    </main>
  )
}

/** Jedna karta na środku spokojnego tła: znak MAGAZYNIER, potem treść. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div className={panelClass + ' p-6 sm:p-8'}>
      <header>
        <BrandLockup />
      </header>
      {children}
    </div>
  )
}

function AuthCard({ callbackError, next }: { callbackError: string | null; next: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(callbackError ? CALLBACK_ERROR : null)
  const [notice, setNotice] = useState<string | null>(null)

  function switchTab(nextTab: Tab) {
    if (busy || nextTab === tab) return
    setTab(nextTab)
    setError(null)
    setNotice(null)
  }

  function enterApp() {
    // Keep the form disabled while the app loads.
    router.replace(next)
    router.refresh()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const address = email.trim()
    if (!address || !password) {
      setError('Podaj adres e-mail i hasło.')
      return
    }
    setError(null)
    setNotice(null)
    setBusy(true)

    try {
      const supabase = createClient()
      if (tab === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password })
        if (signInError) throw signInError
        enterApp()
        return
      }

      const redirect = new URL('/auth/callback', window.location.origin)
      if (next !== '/') redirect.searchParams.set('next', next)
      const name = fullName.trim()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: address,
        password,
        options: {
          emailRedirectTo: redirect.toString(),
          ...(name ? { data: { full_name: name } } : {}),
        },
      })
      if (signUpError) throw signUpError
      if (data.session) {
        enterApp()
        return
      }
      // With e-mail confirmation on, an already registered address returns a user without identities.
      if (data.user && data.user.identities?.length === 0) {
        setError('Konto z tym adresem już istnieje — zaloguj się.')
      } else {
        setNotice(address)
        setPassword('')
      }
      setBusy(false)
    } catch (caught) {
      setError(describeAuthError((caught ?? {}) as AuthErrorLike, tab))
      setBusy(false)
    }
  }

  const signup = tab === 'signup'

  return (
    <>
      <Card>
        <div
          role="tablist"
          aria-label="Logowanie lub rejestracja"
          className={segmentGroupClass + ' mt-8 w-full'}
        >
          <TabButton active={!signup} onClick={() => switchTab('login')}>
            Zaloguj
          </TabButton>
          <TabButton active={signup} onClick={() => switchTab('signup')}>
            Załóż konto
          </TabButton>
        </div>

        <form id="auth-panel" role="tabpanel" onSubmit={handleSubmit} className="mt-7 space-y-5">
          <div>
            <h1 className="text-xl font-semibold leading-snug text-ink">{signup ? 'Załóż konto' : 'Zaloguj się'}</h1>
            <p className="mt-1 text-sm text-ink-2">
              {signup ? 'Konto zakładasz adresem e-mail i hasłem.' : 'Użyj adresu e-mail i hasła swojego konta.'}
            </p>
          </div>

          {signup && (
            <Field label="Imię i nazwisko" hint="opcjonalnie — widoczne w historii zmian">
              <input
                type="text"
                name="name"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={busy}
                maxLength={120}
                className={INPUT}
              />
            </Field>
          )}

          <Field label="E-mail">
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              placeholder="jan.kowalski@firma.pl"
              className={INPUT}
            />
          </Field>

          <Field label="Hasło" hint={signup ? 'co najmniej 6 znaków' : undefined}>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                minLength={signup ? 6 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                className={INPUT + ' pr-20'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-pressed={showPassword}
                className={buttonClass('ghost', 'sm') + ' absolute right-1 top-1/2 -translate-y-1/2'}
              >
                {showPassword ? 'Ukryj' : 'Pokaż'}
              </button>
            </div>
          </Field>

          {error && (
            <Notice tone="alarm" role="alert" className="leading-relaxed">
              {error}
            </Notice>
          )}

          {notice && (
            <Notice tone="ok" role="status" title="Sprawdź skrzynkę e-mail, aby potwierdzić konto." className="leading-relaxed">
              Link wysłaliśmy na adres <span className="font-semibold break-all">{notice}</span>. Po potwierdzeniu zaloguj się tutaj.
            </Notice>
          )}

          <button type="submit" disabled={busy} className={buttonClass('primary', 'lg') + ' w-full'}>
            {busy ? (signup ? 'Tworzenie konta…' : 'Logowanie…') : signup ? 'Załóż konto' : 'Zaloguj'}
          </button>
        </form>
      </Card>

      <aside className="mt-5 px-1 text-sm leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">Role w zespole. </span>
        Pierwsze konto w systemie otrzymuje rolę kierownika. Kolejne osoby zaczynają jako pracownicy — kierownik nadaje
        role w sekcji Ustawienia.
      </aside>
    </>
  )
}

const INPUT = fieldClass + ' h-11'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint && <span className="ml-1.5 text-xs text-mute">({hint})</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="auth-panel"
      onClick={onClick}
      className={segmentClass(active) + ' flex-1'}
    >
      {children}
    </button>
  )
}

function NotConfigured() {
  return (
    <Card>
      <section className="mt-8 border-t border-line pt-6">
        <h1 className="flex items-center gap-2.5 text-xl font-semibold leading-snug text-ink">
          <StateShape kind="warn" size={12} />
          Logowanie nie jest skonfigurowane
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Ta instalacja nie ma kluczy Supabase (<code className="break-all text-[13px] text-ink">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
          <code className="break-all text-[13px] text-ink">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>). Lokalnie aplikacja działa bez logowania —
          jako kierownik.
        </p>
        <Link href="/" className={buttonClass('primary', 'lg') + ' mt-6 w-full'}>
          Przejdź do aplikacji
        </Link>
      </section>
    </Card>
  )
}
