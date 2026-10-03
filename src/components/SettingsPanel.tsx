import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { LoadError, Notice, Skeleton } from './ui/feedback'
import { ChevronIcon } from './ui/icons'
import { StateMark, StateShape } from './ui/StateMark'
import { buttonClass, fieldClass, panelClass } from './ui/styles'

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

// Układ strony ustawień: grupa = opis po lewej (~1/3), kontrolki po prawej. Na wąskim kontenerze jedna kolumna.
const settingsGroup = 'grid gap-x-12 gap-y-5 px-5 py-7 sm:px-7 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @2xl:py-8'
const fieldLabel = 'block text-sm font-medium text-ink'
const hint = 'mt-1.5 block max-w-[68ch] text-[13px] leading-5 text-ink-2'
const checkbox = 'mt-0.5 size-[18px] shrink-0 accent-act disabled:cursor-not-allowed'

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

/** Lewa kolumna grupy: nagłówek i jedno zdanie opisu. */
function GroupIntro({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h2 id={id} className="text-lg font-semibold leading-snug text-ink">{title}</h2>
      <p className="mt-1 max-w-[46ch] text-sm leading-6 text-ink-2">{children}</p>
    </div>
  )
}

export default function SettingsPanel(props: Props) {
  const { canManage, me, health, healthError, settings, settingsState, settingsError, onRetrySettings } = props

  if (!settings) {
    return (
      <section aria-live="polite">
        {settingsState === 'error' ? (
          <LoadError title="Nie udało się pobrać ustawień." detail={settingsError || undefined} onRetry={onRetrySettings} />
        ) : (
          <Skeleton rows={5} label="Wczytuję ustawienia…" />
        )}
      </section>
    )
  }

  return (
    <div className="@container space-y-6">
      <ConfigCard {...props} settings={settings} />
      {canManage && <UsersCard me={me} onToast={props.onToast} />}
      <div className={panelClass + ' divide-y divide-line'}>
        <AiUsageCard settings={settings} />
        <DatabaseCard health={health} healthError={healthError} me={me} />
      </div>
    </div>
  )
}

// --- (a) Konfiguracja agenta i magazynu ------------------------------------------------

function ConfigCard({ canManage, settings, onSettingsSaved, onOpenImport, onToast }: Props & { settings: AppSettings }) {
  const [message, setMessage] = useState('')
  const saved = settingsValues(settings)

  return (
    <section className={panelClass} aria-label="Konfiguracja magazynu">
      {!canManage && (
        <p className="flex items-center gap-2.5 rounded-t-lg border-b border-line bg-ground/60 px-5 py-3 text-sm text-ink-2 sm:px-7">
          <StateShape kind="idle" />
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
  const locked = busy || !canManage

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
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="divide-y divide-line">
        <section className={settingsGroup} aria-labelledby="settings-agent">
          <GroupIntro id="settings-agent" title="Agent">
            Słowo, na które agent reaguje, i sposób rozumienia komend.
          </GroupIntro>
          <fieldset disabled={locked} className="min-w-0 space-y-6">
            <div>
              <label htmlFor="settings-prefix" className={fieldLabel}>Prefix agenta</label>
              <input
                id="settings-prefix"
                aria-describedby="settings-prefix-hint"
                className={fieldClass + ' mt-1.5 max-w-xs'}
                value={form.prefix}
                required
                minLength={2}
                maxLength={30}
                onChange={(event) => change('prefix', event.target.value)}
              />
              <span id="settings-prefix-hint" className={hint}>
                Jedno słowo, np. „Gosiu”. Komendy bez prefixu też działają; poprzedni prefix zostanie wyłączony.
              </span>
            </div>

            <div>
              <label htmlFor="settings-mode" className={fieldLabel}>Tryb agenta</label>
              <select
                id="settings-mode"
                aria-describedby="settings-mode-hint"
                className={fieldClass + ' mt-1.5 max-w-md'}
                value={form.mode}
                disabled={demoMode}
                onChange={(event) => change('mode', event.target.value as SettingsValues['mode'])}
              >
                <option value="llm">LLM — interpretacja przez AI</option>
                <option value="offline">Offline — komendy demo</option>
                <option value="mock">Mock — parser demonstracyjny</option>
              </select>
              <span id="settings-mode-hint" className={hint}>{modeHelp}</span>
            </div>
          </fieldset>
        </section>

        <section className={settingsGroup} aria-labelledby="settings-voice">
          <GroupIntro id="settings-voice" title="Głos">
            Mikrofon, nasłuch na prefix i odpowiedzi czytane na głos.
          </GroupIntro>
          <div className="min-w-0 space-y-6">
            <fieldset disabled={locked} className="min-w-0 space-y-6">
              <div>
                <label htmlFor="settings-voice-mode" className={fieldLabel}>Tryb głosu</label>
                <select
                  id="settings-voice-mode"
                  aria-describedby="settings-voice-mode-hint"
                  className={fieldClass + ' mt-1.5 max-w-md'}
                  value={form.voice_mode}
                  onChange={(event) => change('voice_mode', event.target.value as SettingsValues['voice_mode'])}
                >
                  <option value="push_to_talk">Mikrofon po naciśnięciu przycisku</option>
                  <option value="wake_word">Nasłuch na prefix („{saved.prefix || 'Magu'}, …”) — ręce wolne</option>
                  <option value="text">Tylko tekst — mikrofon wyłączony</option>
                </select>
                <span id="settings-voice-mode-hint" className={hint}>
                  {form.voice_mode === 'wake_word'
                    ? 'Nasłuch włącza się sam po otwarciu aplikacji (przeglądarka raz zapyta o mikrofon); można go wyłączyć w panelu komend. Komenda po prefiksie wysyła się po pauzie; kartę zmiany zatwierdza „zatwierdź”/„tak”, odrzuca „odrzuć”/„nie”. '
                    : form.voice_mode === 'push_to_talk'
                      ? 'Mikrofon włącza się tylko po kliknięciu „Mów”; tekst trzeba wysłać samemu. '
                      : 'Mikrofon nigdy się nie włącza. '}
                  Rozpoznawanie na żywo działa w przeglądarce — w Chrome i Edge dźwięk trafia do usługi rozpoznawania mowy Google. Firefox nagrywa komendę i wysyła ją do transkrypcji na serwerze.
                </span>
              </div>

              <label className="flex min-w-0 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.tts_enabled}
                  onChange={(event) => change('tts_enabled', event.target.checked)}
                  className={checkbox}
                />
                <span className="min-w-0">
                  <span className={fieldLabel}>Czytaj odpowiedzi głosem</span>
                  <span className={hint}>Maks. 2 zdania, polski głos przeglądarki. Domyślnie wyłączone. Brak polskiego głosu lub tryb demo offline oznacza ciszę.</span>
                </span>
              </label>

              <label className="flex min-w-0 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.stt_refine}
                  onChange={(event) => change('stt_refine', event.target.checked)}
                  className={checkbox}
                />
                <span className="min-w-0">
                  <span className={fieldLabel}>Poprawiaj tekst transkrypcją serwera (Gemini/Groq)</span>
                  <span className={hint}>Domyślnie wyłączone — ostateczny jest tekst rozpoznany w przeglądarce. Włącz, jeśli przeglądarka często się myli.</span>
                </span>
              </label>
            </fieldset>

            <button
              type="button"
              onClick={() => speak('Zapisane. Kartony: 52. Propozycję zamówienia masz w kolejce.')}
              disabled={demoMode}
              className={buttonClass('secondary', 'sm')}
            >
              Odsłuchaj próbkę głosu
            </button>
          </div>
        </section>

        <section className={settingsGroup} aria-labelledby="settings-stock">
          <GroupIntro id="settings-stock" title="Stany i zamówienia">
            Skąd pochodzą stany, domyślne minimum i ilość w szkicu zamówienia.
          </GroupIntro>
          <div className="min-w-0 space-y-6">
            <fieldset disabled={locked} className="min-w-0 space-y-6">
              <div>
                <label htmlFor="settings-adapter" className={fieldLabel}>Źródło danych</label>
                <select
                  id="settings-adapter"
                  aria-describedby="settings-adapter-hint"
                  className={fieldClass + ' mt-1.5 max-w-md'}
                  value={form.adapter}
                  onChange={(event) => change('adapter', event.target.value as SettingsValues['adapter'])}
                >
                  <option value="database">Wbudowana baza (Supabase / Postgres)</option>
                  <option value="file_import">Import z pliku XLSX / CSV</option>
                </select>
                <span id="settings-adapter-hint" className={hint}>
                  Import otwiera panel pliku w Stanach. Dane z obu źródeł są przechowywane w bazie; plik Excel aktualizujesz przez eksport.
                </span>
              </div>

              <div>
                <label htmlFor="settings-minimum" className={fieldLabel}>Domyślne minimum nowych pozycji</label>
                <input
                  id="settings-minimum"
                  aria-describedby="settings-minimum-hint"
                  type="number"
                  inputMode="numeric"
                  className={fieldClass + ' mt-1.5 max-w-[12rem] tabular-nums'}
                  min={0}
                  max={MAX_DEFAULT_MINIMUM}
                  step={1}
                  required
                  value={Number.isNaN(form.default_minimum) ? '' : form.default_minimum}
                  onChange={(event) => change('default_minimum', event.target.valueAsNumber)}
                />
                <span id="settings-minimum-hint" className={hint}>
                  Dotyczy nowych pozycji i importu bez minimum. Istniejące progi pozostają zachowane.
                </span>
              </div>

              <div>
                <label htmlFor="settings-reorder-quantity" className={fieldLabel}>Domyślna ilość w szkicu zamówienia</label>
                <input
                  id="settings-reorder-quantity"
                  aria-describedby="settings-reorder-quantity-hint"
                  type="number"
                  inputMode="numeric"
                  className={fieldClass + ' mt-1.5 max-w-[12rem] tabular-nums'}
                  min={1}
                  step={1}
                  required
                  value={Number.isNaN(form.reorder_default_quantity) ? '' : form.reorder_default_quantity}
                  onChange={(event) => change('reorder_default_quantity', event.target.valueAsNumber)}
                />
                <span id="settings-reorder-quantity-hint" className={hint}>
                  Proponowana ilość, gdy stan spadnie poniżej minimum.
                </span>
              </div>
            </fieldset>

            {canManage && saved.adapter === 'file_import' && (
              <button type="button" onClick={onOpenImport} className={buttonClass('secondary', 'sm')}>
                Przejdź do importu
                <ChevronIcon size={14} />
              </button>
            )}
          </div>
        </section>
      </div>

      {error && (
        <div className="px-5 pb-6 sm:px-7">
          <Notice tone="alarm" role="alert">{error}</Notice>
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-b-lg border-t border-line bg-ground/50 px-5 py-4 sm:px-7">
          <p role="status" className={'flex min-w-0 items-center gap-2 text-sm ' + (message ? 'font-medium text-ok-ink' : 'text-ink-2')}>
            {message ? (
              <>
                <StateShape kind="ok" />
                {message}
              </>
            ) : (
              'Zapisz zmiany, aby zastosować je bez restartu aplikacji.'
            )}
          </p>
          <button type="submit" disabled={busy || !dirty} className={buttonClass('action')}>
            {busy ? 'Zapisuję…' : 'Zapisz ustawienia'}
          </button>
        </div>
      )}
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
    <section className={panelClass + ' overflow-hidden'} aria-labelledby="settings-users">
      <div className="px-5 pb-5 pt-7 sm:px-7 @2xl:pt-8">
        <h2 id="settings-users" className="text-lg font-semibold leading-snug text-ink">Użytkownicy</h2>
        <p className="mt-1 max-w-[72ch] text-sm leading-6 text-ink-2">
          Kierownik zatwierdza zamówienia, cofa zmiany i zmienia ustawienia; pracownik zgłasza zmiany. Nowe konta czekają na nadanie roli.
        </p>
      </div>
      {enabled ? (
        <UsersTable currentUserId={me?.user?.id ?? null} onToast={onToast} />
      ) : (
        <p className="flex items-center gap-2.5 border-t border-line bg-ground/60 px-5 py-4 text-sm text-ink-2 sm:px-7">
          <StateShape kind="idle" />
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

  if (state === 'loading') {
    return (
      <div className="border-t border-line px-5 py-5 sm:px-7">
        <Skeleton rows={3} label="Pobieram konta…" />
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="border-t border-line px-5 py-5 sm:px-7">
        <LoadError
          title="Nie udało się pobrać listy kont."
          detail={error || undefined}
          onRetry={() => {
            setState('loading')
            setAttempt((value) => value + 1)
          }}
        />
      </div>
    )
  }
  if (users.length === 0) {
    return <p className="border-t border-line px-5 py-5 text-sm text-ink-2 sm:px-7">Brak kont.</p>
  }

  return (
    <div>
      {actionError && (
        <div className="px-5 pb-5 sm:px-7">
          <Notice tone="alarm" role="alert">Nie zmieniono roli: {actionError}</Notice>
        </div>
      )}
      <div className="relative overflow-x-auto border-t border-line">
        <table className="w-full min-w-[30rem] table-fixed text-left text-sm">
          <thead className="bg-ground/60">
            <tr>
              <th scope="col" className="label-caps px-5 py-3 text-left sm:pl-7">Użytkownik</th>
              <th scope="col" className="label-caps w-[12.5rem] px-5 py-3 text-left">Rola</th>
              <th scope="col" className="label-caps hidden w-36 px-5 py-3 text-left sm:table-cell sm:pr-7">Od</th>
            </tr>
          </thead>
          <tbody>
            {pendingFirst(users).map((user) => {
              const self = user.id === currentUserId
              const pending = user.role === 'oczekujacy'
              return (
                <tr key={user.id} className="border-t border-line transition-colors duration-150 hover:bg-ground/50">
                  <td className="px-5 py-4 align-top sm:pl-7">
                    <div className="truncate font-semibold text-ink">
                      {user.display_name || user.email}
                      {self && <span className="ml-1.5 font-normal text-mute">(Ty)</span>}
                    </div>
                    <div className="mt-0.5 break-all text-[13px] text-ink-2">{user.email}</div>
                    {pending && <StateMark kind="decision" className="mt-1.5">czeka na zatwierdzenie</StateMark>}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <select
                      value={user.role}
                      onChange={(event) => void changeRole(user, event.target.value as Role)}
                      disabled={busyId !== null || self}
                      title={self ? 'Nie możesz zmienić własnej roli' : undefined}
                      aria-label={`Rola: ${user.display_name || user.email}`}
                      className={fieldClass}
                    >
                      <option value="pracownik">{ROLE_LABELS.pracownik}</option>
                      <option value="kierownik">{ROLE_LABELS.kierownik}</option>
                      <option value="oczekujacy">Oczekuje (bez dostępu)</option>
                    </select>
                  </td>
                  <td className="narrow hidden px-5 py-4 align-top tabular-nums text-ink-2 sm:table-cell sm:pr-7">
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
    <section className={settingsGroup} aria-labelledby="settings-ai">
      <GroupIntro
        id="settings-ai"
        title={
          <>
            Użycie AI <span className="font-normal text-ink-2">· wersja <span className="tabular-nums">{settings.version}</span></span>
          </>
        }
      >
        Gotowiec do sekcji „ujawnienie AI” w zgłoszeniu.
      </GroupIntro>
      <div className="min-w-0 space-y-6">
        <dl className="-mt-2.5 divide-y divide-line text-sm">
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
            <dt className="label-caps">LLM</dt>
            <dd className="min-w-0 break-words text-ink">{usage.llm_model} <span className="text-ink-2">· {usage.llm_provider}</span></dd>
            <dd className="col-start-2 sm:col-start-3">
              <StateMark kind={usage.llm_enabled ? 'ok' : 'idle'}>{usage.llm_enabled ? 'aktywne' : 'nieaktywne'}</StateMark>
            </dd>
          </div>
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
            <dt className="label-caps">STT</dt>
            <dd className="min-w-0 break-words text-ink">{usage.stt_model} <span className="text-ink-2">· {usage.stt_provider}</span></dd>
            <dd className="col-start-2 sm:col-start-3">
              <StateMark kind={usage.stt_enabled ? 'ok' : 'idle'}>{usage.stt_enabled ? 'dostępne' : 'nieaktywne'}</StateMark>
            </dd>
          </div>
        </dl>

        <div>
          <label htmlFor="settings-ai-disclosure" className={fieldLabel}>Tekst do zgłoszenia</label>
          <textarea
            id="settings-ai-disclosure"
            ref={disclosureRef}
            readOnly
            value={usage.disclosure}
            rows={6}
            className={fieldClass + ' mt-1.5 resize-y leading-6'}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => void copyDisclosure()} className={buttonClass('secondary', 'sm')}>
            Kopiuj informację o AI
          </button>
          <p role="status" className="text-sm text-ink-2">{message}</p>
        </div>
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
    <section className={settingsGroup} aria-labelledby="settings-db">
      <GroupIntro id="settings-db" title="Baza danych">
        Gdzie trafiają zatwierdzone zmiany i kto ma dostęp.
      </GroupIntro>
      <div className="min-w-0">
        {!health && !healthError && <Skeleton rows={3} label="Sprawdzam serwer…" />}
        {!health && healthError && (
          <Notice tone="alarm" role="alert">
            Nie udało się odczytać stanu serwera: {healthError}
          </Notice>
        )}
        {health && (
          <dl className="-mt-3 divide-y divide-line text-sm">
            <Row label="Magazyn danych" value={storage?.label ?? health.storage} note={storage?.note} warn={health.storage === 'ephemeral'} />
            <Row label="Logowanie" value={auth?.label ?? '—'} note={auth?.note} warn={authMode === 'misconfigured'} />
            <Row label="Tryb agenta (serwer)" value={health.mode} note={health.demo_mode ? 'Tryb demo włączony (DEMO_MODE).' : undefined} />
            <Row label="Status" value={health.status} />
          </dl>
        )}
      </div>
    </section>
  )
}

function Row({ label, value, note, warn = false }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="label-caps sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0">
        <span className={'inline-flex items-center gap-2 font-semibold ' + (warn ? 'text-warn-ink' : 'text-ink')}>
          {warn && <StateShape kind="warn" />}
          {value}
        </span>
        {note && <span className={'mt-0.5 block text-[13px] leading-5 ' + (warn ? 'text-warn-ink' : 'text-ink-2')}>{note}</span>}
      </dd>
    </div>
  )
}
