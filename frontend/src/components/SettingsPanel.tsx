import { useEffect, useRef, useState } from 'react'
import { fetchSettings, saveSettings, type AppSettings, type SettingsValues } from '../api'

type Props = { onSaved: () => void; onOpenImport: () => void }

const fieldClass = 'mt-2 w-full border border-[#d8d6cf] bg-white px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-[#536b56] disabled:bg-[#f5f4f0]'

function values(settings: AppSettings): SettingsValues {
  return { prefix: settings.prefix, mode: settings.mode, adapter: settings.adapter, default_minimum: settings.default_minimum, voice_mode: settings.voice_mode }
}

export default function SettingsPanel({ onSaved, onOpenImport }: Props) {
  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [form, setForm] = useState<SettingsValues | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const disclosureRef = useRef<HTMLTextAreaElement>(null)

  const load = () => fetchSettings()
    .then((result) => {
      setError('')
      setSaved(result)
      setForm(values(result))
    })
    .catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać ustawień.')
    })

  useEffect(() => { void load() }, [])

  const change = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current)
    setMessage('')
  }

  const save = async () => {
    if (!form || !saved || busy) return
    if (!/^[\p{L}]{2,30}$/u.test(form.prefix.trim())) {
      setError('Prefix musi być jednym słowem (2–30 liter).')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    const changes: Partial<SettingsValues> = {}
    for (const key of Object.keys(form) as (keyof SettingsValues)[]) {
      if (form[key] !== saved[key]) Object.assign(changes, { [key]: form[key] })
    }
    try {
      const result = await saveSettings(changes)
      setSaved(result)
      setForm(values(result))
      setMessage('Ustawienia zapisane. Obowiązują od następnej komendy.')
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ustawień.')
    } finally {
      setBusy(false)
    }
  }

  const copyDisclosure = async () => {
    if (!saved) return
    try {
      await navigator.clipboard.writeText(saved.ai_usage.disclosure)
      setMessage('Skopiowano informację o użyciu AI.')
    } catch {
      disclosureRef.current?.select()
      setMessage('Zaznaczono tekst. Skopiuj go skrótem Ctrl+C lub Cmd+C.')
    }
  }

  if (!saved || !form) return (
    <section className="border border-[#e8e5de] bg-white p-6" aria-live="polite">
      {error ? <><p role="alert">{error}</p><button className="mt-3 underline" onClick={() => void load()}>Spróbuj ponownie</button></> : 'Wczytuję ustawienia…'}
    </section>
  )

  const dirty = Object.keys(form).some((key) => form[key as keyof SettingsValues] !== saved[key as keyof SettingsValues])

  return (
    <section className="border border-[#e8e5de] bg-white p-5 sm:p-6">
      <h2 className="text-lg font-bold">Konfiguracja magazynu</h2>
      <p className="mt-1 text-sm text-[#70756f]">Zapisz zmiany, aby zastosować je bez restartu aplikacji.</p>
      <form className="mt-6" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="grid gap-6 md:grid-cols-2">
          <label className="text-sm font-semibold">Prefix agenta
            <input className={fieldClass} value={form.prefix} required minLength={2} maxLength={30} onChange={(event) => change('prefix', event.target.value)} />
            <span className="mt-2 block text-xs font-normal text-[#70756f]">Jedno słowo, np. „Gosiu”. Komendy bez prefixu też działają; poprzedni prefix zostanie wyłączony.</span>
          </label>
          <label className="text-sm font-semibold">Tryb agenta w ustawieniach
            <select className={fieldClass} value={form.mode} disabled={saved.mode_status.demo_mode} onChange={(event) => change('mode', event.target.value as SettingsValues['mode'])}>
              <option value="llm">LLM — interpretacja przez AI</option><option value="offline">Offline — komendy demo</option><option value="mock">Mock — parser demonstracyjny</option>
            </select>
            <span className="mt-2 block text-xs font-normal text-[#70756f]">{saved.mode_status.warning ?? (saved.mode_status.effective_mode === 'llm' ? 'LLM jest skonfigurowane. Zapisy nadal wymagają zatwierdzenia.' : 'Komendy interpretuje parser offline. Internet nie jest wymagany do komend tekstowych.')}</span>
          </label>
          <label className="text-sm font-semibold">Źródło danych
            <select className={fieldClass} value={form.adapter} onChange={(event) => change('adapter', event.target.value as SettingsValues['adapter'])}>
              <option value="sqlite">Wbudowana baza</option><option value="file_import">Import z pliku XLSX / CSV</option>
            </select>
            <span className="mt-2 block text-xs font-normal text-[#70756f]">Import otwiera panel pliku w Stanach. Dane z obu źródeł są przechowywane w bazie; plik Excel aktualizujesz przez eksport.</span>
          </label>
          <label className="text-sm font-semibold">Domyślne minimum nowych pozycji
            <input type="number" className={fieldClass} min={0} max={100000} step={1} required value={Number.isNaN(form.default_minimum) ? '' : form.default_minimum} onChange={(event) => change('default_minimum', event.target.valueAsNumber)} />
            <span className="mt-2 block text-xs font-normal text-[#70756f]">Dotyczy nowych pozycji i importu bez minimum. Istniejące progi pozostają zachowane.</span>
          </label>
          <label className="text-sm font-semibold">Tryb głosu
            <select className={fieldClass} value={form.voice_mode} onChange={(event) => change('voice_mode', event.target.value as SettingsValues['voice_mode'])}>
              <option value="push_to_talk">Mikrofon po naciśnięciu przycisku</option><option value="text">Tylko tekst — mikrofon wyłączony</option>
            </select>
            <span className="mt-2 block text-xs font-normal text-[#70756f]">Nagranie jest uruchamiane wyłącznie przez użytkownika.</span>
          </label>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={busy || !dirty} className="bg-[#536b56] px-5 py-3 text-sm font-semibold text-white hover:bg-[#425845] disabled:opacity-40">{busy ? 'Zapisuję…' : 'Zapisz ustawienia'}</button>
          {saved.adapter === 'file_import' && <button type="button" onClick={onOpenImport} className="text-sm font-semibold underline">Przejdź do importu</button>}
          <p role="status" className="text-sm text-[#315b37]">{message}</p>
        </div>
      </form>
      <div className="mt-8 border-t border-[#e8e5de] pt-6">
        <h3 className="font-bold">Użycie AI · wersja {saved.version}</h3>
        <p className="mt-2 text-sm text-[#70756f]">LLM: {saved.ai_usage.llm_model} · {saved.ai_usage.llm_provider} · {saved.ai_usage.llm_enabled ? 'aktywne' : 'nieaktywne'}</p>
        <p className="mt-1 text-sm text-[#70756f]">STT: {saved.ai_usage.stt_model} · {saved.ai_usage.stt_provider} · {saved.ai_usage.stt_enabled ? 'dostępne' : 'nieaktywne'}</p>
        <label className="mt-4 block text-sm font-semibold">Tekst do zgłoszenia
          <textarea ref={disclosureRef} readOnly value={saved.ai_usage.disclosure} rows={5} className={fieldClass} />
        </label>
        <button type="button" onClick={() => void copyDisclosure()} className="mt-3 border border-[#d8d6cf] px-4 py-2 text-sm font-semibold hover:bg-[#f8f7f3]">Kopiuj informację o AI</button>
      </div>
    </section>
  )
}
