import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, processLock } from '@supabase/supabase-js'
import { AppState, Platform } from 'react-native'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
export const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? ''

function checkConfiguration() {
  if (!url || !key || !apiUrl) return 'Uzupełnij adres API i publiczne dane projektu Supabase w mobile/.env. Następnie uruchom Expo ponownie.'
  try {
    for (const address of [url, apiUrl]) {
      const parsed = new URL(address)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid URL')
    }
  } catch { return 'Adres API i adres Supabase muszą być poprawnymi adresami HTTP lub HTTPS.' }
  return null
}
export const configurationError = checkConfiguration()

export const supabase = !configurationError && url && key ? createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
}) : null

if (Platform.OS !== 'web' && supabase) {
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase!.auth.startAutoRefresh()
    else supabase!.auth.stopAutoRefresh()
  })
  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh()
}
