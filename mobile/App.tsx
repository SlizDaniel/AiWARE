import './global.css'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import type { Session } from '@supabase/supabase-js'
import { Button, Loading, Message } from './src/components/ui'
import { WarehouseApp } from './src/components/WarehouseApp'
import { LoginScreen } from './src/screens/LoginScreen'
import { api } from './src/lib/api'
import { configurationError, supabase } from './src/lib/supabase'
import { withTimeout } from './src/lib/withTimeout'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    setError('')
    let alive = true
    let eventReceived = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      eventReceived = true
      if (alive) { setSession(next); setLoading(false); setError('') }
    })
    withTimeout(supabase.auth.getSession(), 15_000,
      'Nie udało się odczytać sesji w ciągu 15 sekund. Sprawdź połączenie z internetem i spróbuj ponownie.').then(({ data, error }) => {
      if (!alive || eventReceived) return
      if (error) setError(error.message)
      setSession(data.session); setLoading(false)
    }).catch(error => { if (alive && !eventReceived) { setError(error instanceof Error ? error.message : 'Nie udało się odczytać sesji.'); setLoading(false) } })
    return () => { alive = false; subscription.unsubscribe() }
  }, [attempt])

  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f5f4f0' }}><StatusBar style="dark" />
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {configurationError ? <View className="p-6"><Message error>{configurationError}</Message></View> :
        loading ? <Loading /> : session && api ? <WarehouseApp key={session.user.id} api={api} /> :
          <ScrollView keyboardShouldPersistTaps="handled">{error ? <View className="gap-3 p-4"><Message error>{error}</Message><Button title="Ponów odczyt sesji" onPress={() => setAttempt(value => value + 1)} /></View> : null}<LoginScreen /></ScrollView>}
    </KeyboardAvoidingView>
  </SafeAreaView></SafeAreaProvider>
}
