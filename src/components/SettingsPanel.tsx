import { useEffect, useRef, useState } from 'react'
import {
  fetchUsers,
  ROLE_LABELS,
  saveSettings,
  updateUserRole,
  type AppSettings,
  type AuthMode,
  type Health,
  type Me,
  type Role,
  type SettingsValues,
  type StorageKind,
  type UserAccount,
} from '@/lib/api'
import { speak } from '@/lib/tts'
import { changedSettings, MAX_DEFAULT_MINIMUM, pendingFirst, settingsValues, validateSettings } from './settingsForm'

type LoadState = 'loading' | 'ready' | 'error'

type Props = {
  canManage: boolean
  me: Me | null
  health: Health | null
  healthError: string
  settings: AppSettings | null
  settingsState: LoadState
  settingsError: string
  onRetrySettings: () => void
  onSettingsSaved: (settings: AppSettings) => void
  onOpenImport: () => void
  onToast: (message: string) => void
}

const card = 'border border-[#e8e5de] bg-white p-5 sm:p-6'
const fieldLabel = 'block text-sm font-semibold text-[#454b46]'
const input =
  'mt-1.5 block w-full border border-[#d8d6cf] bg-white px-3 py-2.5 text-sm text-[#292d2b] focus-visible:border-[#536b56] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:bg-[#f8f7f3] disabled:text-[#646b64]'
const hint = 'mt-1.5 block text-xs font-normal text-[#70756f]'

const STORAGE_LABELS: Record<StorageKind, { label: string; note: string }> = {
  supabase: { label: 'Supabase (PostgreSQL)', note: 'Dane trwałe w chmurze.' },
  postgres: { label: 'PostgreSQL', note: 'Dane trwałe — baza z DATABASE_URL.' },
  pglite: { label: 'PGlite (plik lokalny)', note: 'Dane trwałe na tym komputerze.' },
  ephemeral: { label: 'Pamięć tymczasowa', note: 'Brak DATABASE_URL — zmiany znikną po restarcie serwera.' },
}

const AUTH_LABELS: Record<AuthMode, { label: string; note: string }> = {
  supabase: { label: 'Supabase Auth', note: 'Logowanie kontem; role kierownik i pracownik.' },
  disabled: { label: 'Wyłączone', note: 'Tryb lokalny bez logowania — każdy działa jako kierownik.' },
  misconfigured: { label: 'Błędna konfiguracja', note: 'Brakuje kluczy Supabase — API odmawia dostępu do danych.' },
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export default function SettingsPanel(props: Props) {
  const { canManage, me, health, healthError, settings, settingsState, settingsError, onRetrySettings } = props

  if (!settings) {
    return (
      <section className={card} aria-live="polite">
        {settingsState === 'error' ? (
          <div role="alert">
            <p className="font-semibold text-[#8f3936]">Nie udało się pobrać ustawień.</p>
            {settingsError && <p className="mt-1 text-sm text-[#8f3936]">{settingsError}</p>}
            <button
              type="button"
              onClick={onRetrySettings}
              className="mt-3 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
            >
              Spróbuj ponownie
            </button>
          </div>
        ) : (
          <p className="text-sm text-[#646b64]" role="status">Wczytuję ustawienia…</p>
        )}
      </section>
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ConfigCard {...props} settings={settings} />
      {canManage && <UsersCard me={me} onToast={props.onToast} />}
      <AiUsageCard settings={settings} />
      <DatabaseCard health={health} healthError={healthError} me={me} />
    </div>
  )
}

// --- (a) Konfiguracja agenta i magazynu ------------------------------------------------

function ConfigCard({ canManage, settings, onSettingsSaved, onOpenImport, onToast }: Props & { settings: AppSettings }) {
  const [message, setMessage] = useState('')
  const saved = settingsValues(settings)

  return (
    <section className={card + ' xl:col-span-2'} aria-labelledby="settings-config">
      <h2 id="settings-config" className="text-lg font-bold">Konfiguracja magazynu</h2>
      <p className="mt-1 text-sm text-[#646b64]">Zapisz zmiany, aby zastosować je bez restartu aplikacji.</p>
      {!canManage && (
        <p className="mt-4 border border-[#e8e5de] bg-[#f8f7f3] px-4 py-3 text-sm text-[#646b64]">
          Ustawienia zmienia kierownik — widzisz je tylko do odczytu.
        </p>
      )}
      <SettingsForm
        // nowe wartości z serwera (zapis, polling) → formularz startuje od nich; ten sam stan → bez resetu
        key={JSON.stringify(saved)}
        settings={settings}
        saved={saved}
        canManage={canManage}
        message={message}
        onEdit={() => setMessage('')}
        onSaved={(result) => {
          setMessage('Ustawienia zapisane. Obowiązują od następnej komendy.')
          onSettingsSaved(result)
          onToast('Ustawienia zapisane.')
        }}
        onOpenImport={onOpenImport}
      />
    </section>
  )
}

function SettingsForm({
  settings,
  saved,
  canManage,
  message,
  onEdit,
  onSaved,
  onOpenImport,
}: {
  settings: AppSettings
  saved: SettingsValues
  canManage: boolean
  message: string
  onEdit: () => void
  onSaved: (settings: AppSettings) => void
  onOpenImport: () => void
}) {
  const [form, setForm] = useState<SettingsValues>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const demoMode = settings.mode_status.demo_mode
  const changes = changedSettings(form, saved)
  const dirty = Object.keys(changes).length > 0

  const change = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
    onEdit()
  }

  const save = async () => {
    if (!canManage || busy || !dirty) return
    const invalid = validateSettings(form)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError('')
    try {
      onSaved(await saveSettings(changes))
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się zapisać ustawień.'))
    } finally {
      setBusy(false)
    }
  }

  const modeHelp =
    settings.mode_status.warning ??
    (settings.mode_status.effective_mode === 'llm'
      ? 'LLM jest skonfigurowane. Zapisy nadal wymagają zatwierdzenia.'
      : 'Komendy interpretuje parser offline. Internet nie jest wymagany do komend tekstowych.')

  return (
    <form
      className="mt-6"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset disabled={busy || !canManage} className="grid gap-6 md:grid-cols-2">
        <label className={fieldLabel}>
          Prefix agenta
          <input
            className={input}
            value={form.prefix}
            required
            minLength={2}
            maxLength={30}
            onChange={(event) => change('prefix', event.target.value)}
          />
          <span className={hint}>Jedno słowo, np. „Gosiu”. Komendy bez prefixu też działają; poprzedni prefix zostanie wyłączony.</span>
        </label>

        <label className={fieldLabel}>
          Tryb agenta
          <select
            className={input}
            value={form.mode}
            disabled={demoMode}
            onChange={(event) => change('mode', event.target.value as SettingsValues['mode'])}
          >
            <option value="llm">LLM — interpretacja przez AI</option>
            <option value="offline">Offline — komendy demo</option>
            <option value="mock">Mock — parser demonstracyjny</option>
          </select>
          <span className={hint}>{modeHelp}</span>
        </label>

        <label className={fieldLabel}>
          Źródło danych
          <select
            className={input}
            value={form.adapter}
            onChange={(event) => change('adapter', event.target.value as SettingsValues['adapter'])}
          >
            <option value="database">Wbudowana baza (Supabase / Postgres)</option>
            <option value="file_import">Import z pliku XLSX / CSV</option>
          </select>
          <span className={hint}>Import otwiera panel pliku w Stanach. Dane z obu źródeł są przechowywane w bazie; plik Excel aktualizujesz przez eksport.</span>
        </label>

        <label className={fieldLabel}>
          Domyślne minimum nowych pozycji
          <input
            type="number"
            inputMode="numeric"
            className={input}
            min={0}
            max={MAX_DEFAULT_MINIMUM}
            step={1}
            required
            value={Number.isNaN(form.default_minimum) ? '' : form.default_minimum}
            onChange={(event) => change('default_minimum', event.target.valueAsNumber)}
          />
          <span className={hint}>Dotyczy nowych pozycji i importu bez minimum. Istniejące progi pozostają zachowane.</span>
        </label>

        <label className={fieldLabel}>
          Tryb głosu
          <select
            className={input}
            value={form.voice_mode}
            onChange={(event) => change('voice_mode', event.target.value as SettingsValues['voice_mode'])}
          >
            <option value="push_to_talk">Mikrofon po naciśnięciu przycisku</option>
            <option value="wake_word">Nasłuch na prefix („{saved.prefix || 'Magu'}, …”) — ręce wolne</option>
            <option value="text">Tylko tekst — mikrofon wyłączony</option>
          </select>
          <span className={hint}>
            {form.voice_mode === 'wake_word'
              ? 'Nasłuch włącza się sam po otwarciu aplikacji (przeglądarka raz zapyta o mikrofon); można go wyłączyć w panelu komend. Komenda po prefiksie wysyła się po pauzie; kartę zmiany zatwierdza „zatwierdź”/„tak”, odrzuca „odrzuć”/„nie”. '
              : form.voice_mode === 'push_to_talk'
                ? 'Mikrofon włącza się tylko po kliknięciu „Mów”; tekst trzeba wysłać samemu. '
                : 'Mikrofon nigdy się nie włącza. '}
            Rozpoznawanie na żywo działa w przeglądarce — w Chrome i Edge dźwięk trafia do usługi rozpoznawania mowy Google. Firefox nagrywa komendę i wysyła ją do transkrypcji na serwerze.
          </span>
        </label>

        <label className={fieldLabel}>
          Domyślna ilość w szkicu zamówienia
          <input
            type="number"
            inputMode="numeric"
            className={input}
            min={1}
            step={1}
            required
            value={Number.isNaN(form.reorder_default_quantity) ? '' : form.reorder_default_quantity}
            onChange={(event) => change('reorder_default_quantity', event.target.valueAsNumber)}
          />
          <span className={hint}>Proponowana ilość, gdy stan spadnie poniżej minimum.</span>
        </label>

        <div className="flex flex-wrap items-start justify-between gap-3 md:col-span-2">
          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.tts_enabled}
              onChange={(event) => change('tts_enabled', event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[#315b37] disabled:cursor-not-allowed"
            />
            <span>
              <span className="font-semibold text-[#454b46]">Czytaj odpowiedzi głosem</span>
              <span className={hint}>Maks. 2 zdania, polski głos przeglądarki. Domyślnie wyłączone. Brak polskiego głosu lub tryb demo offline oznacza ciszę.</span>
            </span>
          </label>
        </div>
      </fieldset>

      {error && (
        <p className="mt-4 border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936]" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {canManage && (
          <button
            type="submit"
            disabled={busy || !dirty}
            className="bg-[#315b37] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#274a2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Zapisuję…' : 'Zapisz ustawienia'}
          </button>
        )}
        {canManage && saved.adapter === 'file_import' && (
          <button
            type="button"
            onClick={onOpenImport}
            className="text-sm font-semibold text-[#315b37] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
          >
            Przejdź do importu
          </button>
        )}
        <button
          type="button"
          onClick={() => speak('Zapisane. Kartony: 52. Propozycję zamówienia masz w kolejce.')}
          disabled={demoMode}
          className="border border-[#d8d6cf] bg-white px-3 py-2 text-sm font-semibold text-[#454b46] transition-colors hover:bg-[#f8f7f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Odsłuchaj próbkę głosu
        </button>
        <p role="status" className="text-sm text-[#315b37]">{message}</p>
      </div>
    </form>
  )
}

// --- (b) Użytkownicy -----------------------------------------------------------------

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(date)
}

function UsersCard({ me, onToast }: { me: Me | null; onToast: (message: string) => void }) {
  const enabled = me?.auth_mode === 'supabase'
  return (
    <section className={card} aria-labelledby="settings-users">
      <h2 id="settings-users" className="text-lg font-bold">Użytkownicy</h2>
      <p className="mt-1 text-sm text-[#646b64]">Kierownik zatwierdza zamówienia, cofa zmiany i zmienia ustawienia; pracownik zgłasza zmiany. Nowe konta czekają na nadanie roli.</p>
      {enabled ? (
        <UsersTable currentUserId={me?.user?.id ?? null} onToast={onToast} />
      ) : (
        <p className="mt-4 border border-[#e8e5de] bg-[#f8f7f3] px-4 py-3 text-sm text-[#646b64]">
          Konta i role działają po włączeniu logowania Supabase. W trybie lokalnym każdy działa jako kierownik.
        </p>
      )}
    </section>
  )
}

function UsersTable({ currentUserId, onToast }: { currentUserId: string | null; onToast: (message: string) => void }) {
  const [users, setUsers] = useState<UserAccount[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    fetchUsers().then(
      (list) => {
        if (!alive) return
        setUsers(list)
        setState('ready')
        setError('')
      },
      (reason: unknown) => {
        if (!alive) return
        setState('error')
        setError(errorMessage(reason, 'Nie udało się pobrać listy kont.'))
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const changeRole = async (user: UserAccount, role: Role) => {
    if (busyId !== null || role === user.role) return
    setBusyId(user.id)
    setActionError('')
    try {
      const updated = await updateUserRole(user.id, role)
      setUsers((list) => list.map((item) => (item.id === user.id ? { ...item, ...updated } : item)))
      onToast(`Zmieniono rolę: ${user.display_name || user.email} → ${ROLE_LABELS[updated.role] ?? updated.role}`)
    } catch (reason) {
      setActionError(errorMessage(reason, 'Nie udało się zmienić roli.'))
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'loading') return <p className="mt-4 text-sm text-[#646b64]" role="status">Pobieram konta…</p>
  if (state === 'error') {
    return (
      <div className="mt-4 border border-[#edc8c5] bg-[#fff7f6] p-4" role="alert">
        <p className="font-semibold text-[#8f3936]">Nie udało się pobrać listy kont.</p>
        {error && <p className="mt-1 text-sm text-[#8f3936]">{error}</p>}
        <button
          type="button"
          onClick={() => {
            setState('loading')
            setAttempt((value) => value + 1)
          }}
          className="mt-3 border border-[#d8a9a5] bg-white px-4 py-2 text-sm font-semibold text-[#8f3936] hover:bg-[#fdebec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f3936]"
        >
          Spróbuj ponownie
        </button>
      </div>
    )
  }
  if (users.length === 0) return <p className="mt-4 text-sm text-[#646b64]">Brak kont.</p>

  return (
    <div className="mt-4">
      {actionError && (
        <p className="mb-3 border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936]" role="alert">
          Nie zmieniono roli: {actionError}
        </p>
      )}
      <table className="w-full table-fixed text-left text-sm">
        <thead>
          <tr className="border-b border-[#e8e5de] text-[11px] font-semibold uppercase tracking-[0.1em] text-[#70756f]">
            <th scope="col" className="py-2 pr-3">Użytkownik</th>
            <th scope="col" className="w-[9.5rem] py-2 pr-3">Rola</th>
            <th scope="col" className="hidden w-28 py-2 sm:table-cell">Od</th>
          </tr>
        </thead>
        <tbody>
          {pendingFirst(users).map((user) => {
            const self = user.id === currentUserId
            const pending = user.role === 'oczekujacy'
            return (
              <tr key={user.id} className={'border-b border-[#f0efe9] last:border-0' + (pending ? ' bg-[#fffaf0]' : '')}>
                <td className="py-3 pr-3 align-top">
                  <div className="truncate font-semibold text-[#292d2b]">
                    {user.display_name || user.email}
                    {self && <span className="ml-1 font-normal text-[#70756f]">(Ty)</span>}
                  </div>
                  {pending && (
                    <span className="mt-1 inline-block bg-[#fbf3db] px-2 py-0.5 text-xs font-bold text-[#805c12]">czeka na zatwierdzenie</span>
                  )}
                  <div className="break-all text-xs text-[#70756f]">{user.email}</div>
                </td>
                <td className="py-3 pr-3 align-top">
                  <select
                    value={user.role}
                    onChange={(event) => void changeRole(user, event.target.value as Role)}
                    disabled={busyId !== null || self}
                    title={self ? 'Nie możesz zmienić własnej roli' : undefined}
                    aria-label={`Rola: ${user.display_name || user.email}`}
                    className="w-full border border-[#d8d6cf] bg-white px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="pracownik">{ROLE_LABELS.pracownik}</option>
                    <option value="kierownik">{ROLE_LABELS.kierownik}</option>
                    <option value="oczekujacy">Oczekuje (bez dostępu)</option>
                  </select>
                </td>
                <td className="hidden py-3 align-top text-xs text-[#646b64] sm:table-cell">{formatDate(user.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- (c) Użycie AI -------------------------------------------------------------------

function AiUsageCard({ settings }: { settings: AppSettings }) {
  const usage = settings.ai_usage
  const disclosureRef = useRef<HTMLTextAreaElement>(null)
  const [message, setMessage] = useState('')

  const copyDisclosure = async () => {
    try {
      await navigator.clipboard.writeText(usage.disclosure)
      setMessage('Skopiowano informację o użyciu AI.')
    } catch {
      // brak dostępu do schowka → zaznacz tekst, użytkownik kopiuje skrótem
      disclosureRef.current?.select()
      setMessage('Zaznaczono tekst. Skopiuj go skrótem Ctrl+C lub Cmd+C.')
    }
  }

  return (
    <section className={card} aria-labelledby="settings-ai">
      <h2 id="settings-ai" className="text-lg font-bold">Użycie AI · wersja {settings.version}</h2>
      <p className="mt-1 text-sm text-[#646b64]">Gotowiec do sekcji „ujawnienie AI” w zgłoszeniu.</p>
      <dl className="mt-4 space-y-1 text-sm text-[#70756f]">
        <div>
          <dt className="inline font-semibold text-[#454b46]">LLM: </dt>
          <dd className="inline">{usage.llm_model} · {usage.llm_provider} · {usage.llm_enabled ? 'aktywne' : 'nieaktywne'}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-[#454b46]">STT: </dt>
          <dd className="inline">{usage.stt_model} · {usage.stt_provider} · {usage.stt_enabled ? 'dostępne' : 'nieaktywne'}</dd>
        </div>
      </dl>
      <label className={fieldLabel + ' mt-4'}>
        Tekst do zgłoszenia
        <textarea
          ref={disclosureRef}
          readOnly
          value={usage.disclosure}
          rows={6}
          className={input + ' resize-y font-mono text-xs leading-5'}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void copyDisclosure()}
          className="bg-[#292d2b] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#454b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
        >
          Kopiuj informację o AI
        </button>
        <p role="status" className="text-sm text-[#315b37]">{message}</p>
      </div>
    </section>
  )
}

// --- (d) Baza danych -----------------------------------------------------------------

function DatabaseCard({ health, healthError, me }: { health: Health | null; healthError: string; me: Me | null }) {
  const storage = health ? STORAGE_LABELS[health.storage] : null
  const authMode = me?.auth_mode ?? health?.auth_mode ?? null
  const auth = authMode ? AUTH_LABELS[authMode] : null

  return (
    <section className={card} aria-labelledby="settings-db">
      <h2 id="settings-db" className="text-lg font-bold">Baza danych</h2>
      <p className="mt-1 text-sm text-[#646b64]">Gdzie trafiają zatwierdzone zmiany i kto ma dostęp.</p>
      {!health && !healthError && <p className="mt-4 text-sm text-[#646b64]" role="status">Sprawdzam serwer…</p>}
      {!health && healthError && (
        <p className="mt-4 border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#8f3936]" role="alert">
          Nie udało się odczytać stanu serwera: {healthError}
        </p>
      )}
      {health && (
        <dl className="mt-4 divide-y divide-[#f0efe9] text-sm">
          <Row label="Magazyn danych" value={storage?.label ?? health.storage} note={storage?.note} warn={health.storage === 'ephemeral'} />
          <Row label="Logowanie" value={auth?.label ?? '—'} note={auth?.note} warn={authMode === 'misconfigured'} />
          <Row label="Tryb agenta (serwer)" value={health.mode} note={health.demo_mode ? 'Tryb demo włączony (DEMO_MODE).' : undefined} />
          <Row label="Status" value={health.status} />
        </dl>
      )}
    </section>
  )
}

function Row({ label, value, note, warn = false }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[#70756f]">{label}</dt>
      <dd className="min-w-0 sm:text-right">
        <span className={'font-semibold ' + (warn ? 'text-[#805c12]' : 'text-[#292d2b]')}>{value}</span>
        {note && <span className={'block text-xs ' + (warn ? 'text-[#805c12]' : 'text-[#70756f]')}>{note}</span>}
      </dd>
    </div>
  )
}
