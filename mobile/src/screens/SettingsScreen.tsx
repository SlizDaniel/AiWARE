import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { Warehouse } from '../hooks/useWarehouse'
import { supabase } from '../lib/supabase'
// Walidacja i wykrywanie zmian wspólne z klientem webowym (karta 12).
import { changedSettings, settingsValues, validateSettings } from '../../../src/components/settingsForm'
import type { SettingsValues } from '../../../src/lib/api'

const VOICE_MODES: { value: SettingsValues['voice_mode']; label: string; hint: string }[] = [
  { value: 'wake_word', label: 'Nasłuch na prefix', hint: 'Mów bez klikania: „{prefix}, …” — nasłuch włączasz przyciskiem w panelu komend, komenda wyśle się sama. Kartę zmiany zatwierdzisz głosem („tak”/„nie”).' },
  { value: 'push_to_talk', label: 'Mikrofon po naciśnięciu', hint: 'Nagrywasz komendę przyciskiem, sprawdzasz transkrypcję i wysyłasz.' },
  { value: 'text', label: 'Tylko tekst', hint: 'Mikrofon wyłączony — komendy wpisujesz z klawiatury.' },
]

const ADAPTERS: { value: SettingsValues['adapter']; label: string }[] = [
  { value: 'database', label: 'Wbudowana baza (Supabase / Postgres)' },
  { value: 'file_import', label: 'Import z pliku XLSX / CSV' },
]

function voiceLabel(value: SettingsValues['voice_mode']): string {
  return VOICE_MODES.find(mode => mode.value === value)?.label ?? value
}

export function SettingsScreen({ data, api, reload }: { data: Warehouse; api: Api; reload: () => Promise<void> }) {
  const saved = settingsValues(data.settings)
  const [prefix, setPrefix] = useState(saved.prefix)
  const [mode, setMode] = useState(saved.mode)
  const [adapter, setAdapter] = useState(saved.adapter)
  const [voice, setVoice] = useState(saved.voice_mode)
  const [tts, setTts] = useState(saved.tts_enabled)
  const [minimum, setMinimum] = useState(String(saved.default_minimum))
  const [quantity, setQuantity] = useState(String(saved.reorder_default_quantity))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const manager = data.user.role === 'kierownik'
  const draft: SettingsValues = {
    prefix, mode, adapter, voice_mode: voice, tts_enabled: tts,
    default_minimum: Number(minimum), reorder_default_quantity: Number(quantity),
    // stt_refine dotyczy tylko poprawiania tekstu z rozpoznawania przeglądarki na webie;
    // na telefonie transkrypcja zawsze idzie na serwer, więc nie wystawiamy go w UI.
    stt_refine: saved.stt_refine,
  }
  // Tylko pola różniące się od zapisanych — ten sam kontrakt co panel webowy.
  const changes = changedSettings(draft, saved)
  const dirty = Object.keys(changes).length > 0

  async function save() {
    if (busy || !dirty) return
    const invalid = validateSettings(draft)
    if (invalid) { setError(invalid); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await api.saveSettings(changes)
      await reload(); setMessage('Zapisano ustawienia.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać ustawień.') }
    finally { setBusy(false) }
  }

  async function logout() {
    if (busy) return
    setBusy(true); setError('')
    try { const { error } = await supabase!.auth.signOut({ scope: 'local' }); if (error) throw error }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się wylogować.') }
    finally { setBusy(false) }
  }

  return <View>
    <Card><Title>Twoje konto</Title><Text className="text-base text-ink">{data.user.display_name}</Text>
      <Text className="text-stone-600">{data.user.email} · {manager ? 'kierownik' : 'pracownik'}</Text>
      <Button title="Wyloguj się" secondary onPress={() => void logout()} disabled={busy} /></Card>
    {error ? <Message error>{error}</Message> : null}{message ? <Message>{message}</Message> : null}
    {manager ? <Card><Title>Ustawienia agenta</Title>
      <Field label="Imię / prefix agenta" value={prefix} onChangeText={setPrefix} />
      <Text className="text-sm text-stone-500">Jedno słowo (2–30 liter), np. „Gosiu”. Komendy bez prefixu też działają.</Text>
      <Text className="font-medium text-ink">Tryb interpretacji</Text><View className="flex-row gap-2">
        {(['llm', 'offline', 'mock'] as const).map(value => <View key={value} className="flex-1"><Button title={value === 'llm' ? 'AI' : value === 'offline' ? 'Offline' : 'Mock'}
          secondary={mode !== value} disabled={busy || data.health.demo_mode} onPress={() => setMode(value)} /></View>)}
      </View>
      <Text className="font-medium text-ink">Tryb głosu</Text>
      {VOICE_MODES.map(({ value, label, hint }) => <View key={value} className="gap-1">
        <Button title={label} secondary={voice !== value} disabled={busy} onPress={() => setVoice(value)} />
        {voice === value ? <Text className="px-1 text-sm leading-5 text-stone-500">{hint.replace('{prefix}', saved.prefix || 'Magu')}</Text> : null}
      </View>)}
      <Text className="font-medium text-ink">Źródło danych</Text>
      {ADAPTERS.map(({ value, label }) => <Button key={value} title={label} secondary={adapter !== value} disabled={busy} onPress={() => setAdapter(value)} />)}
      <Text className="text-sm text-stone-500">Dane z obu źródeł trafiają do bazy; plik XLSX/CSV importujesz w Stanych.</Text>
      <Field label="Minimum nowych pozycji" value={minimum} onChangeText={setMinimum} />
      <Field label="Ilość w szkicu zamówienia" value={quantity} onChangeText={setQuantity} />
      <View className="flex-row items-center justify-between"><Text className="flex-1 text-base text-ink">Czytaj odpowiedzi po polsku</Text>
        <Switch accessibilityLabel="Czytaj odpowiedzi po polsku" value={tts} disabled={busy} onValueChange={setTts} trackColor={{ true: '#315b45' }} /></View>
      <Button title={busy ? 'Zapisywanie…' : 'Zapisz ustawienia'} disabled={busy || !dirty || data.health.demo_mode} onPress={() => void save()} />
    </Card> : <Message>Ustawienia agenta zmienia kierownik. Aktualnie: prefix „{saved.prefix}”, głos — {voiceLabel(saved.voice_mode)}, interpretacja — {saved.mode}.</Message>}
    <Card><Title>Użycie AI</Title><Text className="leading-6 text-stone-600">{data.settings.ai_usage.disclosure}</Text>
      <Text className="text-sm text-stone-500">Głos na telefonie: nagrywanie po naciśnięciu albo nasłuch na prefix, transkrypcja na serwerze. Tekst pozostaje dostępny przy awarii STT.</Text></Card>
  </View>
}
