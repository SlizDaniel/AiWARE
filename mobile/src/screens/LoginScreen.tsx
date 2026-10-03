import { useState } from 'react'
import { Text, View } from 'react-native'
import { Button, Card, Field, Message, Title } from '../components/ui'
import { supabase } from '../lib/supabase'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function login() {
    setBusy(true); setError('')
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
    } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zalogować.') }
    finally { setBusy(false) }
  }

  return <View className="gap-5 px-5 py-10">
    <Text className="text-sm font-bold uppercase tracking-widest text-forest">MAGAZYNIER / MOBILE</Text>
    <Text className="text-4xl font-bold text-ink">Twój magazyn.{ '\n' }Pod ręką.</Text>
    <Text className="text-base leading-6 text-stone-600">Mów, sprawdzaj stany i zatwierdzaj zmiany podczas pracy na hali.</Text>
    <Card><Title>Zaloguj się</Title>
      <Field label="E-mail" value={email} onChangeText={setEmail} email />
      <Field label="Hasło" value={password} onChangeText={setPassword} secure />
      {error ? <Message error>{error}</Message> : null}
      <Button title={busy ? 'Logowanie…' : 'Wejdź do magazynu'} onPress={() => void login()} disabled={busy || !email.trim() || !password} />
      <Text className="text-sm leading-5 text-stone-500">Użyj konta z aplikacji webowej. Dostęp i uprawnienia nadaje kierownik.</Text>
    </Card>
  </View>
}
