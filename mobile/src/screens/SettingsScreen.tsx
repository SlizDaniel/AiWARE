import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { Warehouse } from '../hooks/useWarehouse'
import { supabase } from '../lib/supabase'

export function SettingsScreen({ data, api, reload }: { data: Warehouse; api: Api; reload: () => Promise<void> }) {
  const [prefix, setPrefix] = useState(data.settings.prefix)
  const [mode, setMode] = useState(data.settings.mode)
  const [minimum, setMinimum] = useState(String(data.settings.default_minimum))
  const [quantity, setQuantity] = useState(String(data.settings.reorder_default_quantity))
  const [tts, setTts] = useState(data.settings.tts_enabled)
  const [voice, setVoice] = useState(data.settings.voice_mode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const manager = data.user.role === 'kierownik'

  async function save() {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (!minimum.trim() || !quantity.trim()) throw new Error('Uzupełnij minimum i ilość zamówienia.')
      await api.saveSettings({ prefix, mode, voice_mode: voice, default_minimum: Number(minimum), reorder_default_quantity: Number(quantity), tts_enabled: tts })
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
      <Text className="font-medium text-ink">Tryb interpretacji</Text><View className="flex-row gap-2">
        {(['llm', 'offline', 'mock'] as const).map(value => <View key={value} className="flex-1"><Button title={value === 'llm' ? 'AI' : value === 'offline' ? 'Offline' : 'Mock'}
          secondary={mode !== value} disabled={busy || data.health.demo_mode} onPress={() => setMode(value)} /></View>)}
      </View>
      <Field label="Minimum nowych pozycji" value={minimum} onChangeText={setMinimum} />
      <Field label="Ilość w szkicu zamówienia" value={quantity} onChangeText={setQuantity} />
      <View className="flex-row items-center justify-between"><Text className="flex-1 text-base text-ink">Komendy głosowe</Text>
        <Switch accessibilityLabel="Komendy głosowe" value={voice !== 'text'} disabled={busy} onValueChange={on => setVoice(on ? 'push_to_talk' : 'text')} trackColor={{ true: '#315b45' }} /></View>
      <View className="flex-row items-center justify-between"><Text className="flex-1 text-base text-ink">Czytaj odpowiedzi po polsku</Text>
        <Switch accessibilityLabel="Czytaj odpowiedzi po polsku" value={tts} disabled={busy} onValueChange={setTts} trackColor={{ true: '#315b45' }} /></View>
      <Button title={busy ? 'Zapisywanie…' : 'Zapisz ustawienia'} disabled={busy || data.health.demo_mode} onPress={() => void save()} />
    </Card> : <Message>Ustawienia agenta zmienia kierownik. Twój aktualny tryb: {data.settings.mode}.</Message>}
    <Card><Title>Użycie AI</Title><Text className="leading-6 text-stone-600">{data.settings.ai_usage.disclosure}</Text>
      <Text className="text-sm text-stone-500">Głos na telefonie: nagrywanie po naciśnięciu, transkrypcja na serwerze. Tekst pozostaje dostępny przy awarii STT.</Text></Card>
  </View>
}
