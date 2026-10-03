import type { AppSettings, SettingsValues } from '@/lib/api'

export const SETTINGS_KEYS = [
  'prefix',
  'mode',
  'adapter',
  'default_minimum',
  'voice_mode',
  'tts_enabled',
  'reorder_default_quantity',
] as const satisfies readonly (keyof SettingsValues)[]

export const PREFIX_PATTERN = /^\p{L}{2,30}$/u
export const MAX_DEFAULT_MINIMUM = 100000

/** Same wartości formularza (bez statusu trybu, wersji i opisu AI). */
export function settingsValues(settings: AppSettings): SettingsValues {
  return {
    prefix: settings.prefix,
    mode: settings.mode,
    adapter: settings.adapter,
    default_minimum: settings.default_minimum,
    voice_mode: settings.voice_mode,
    tts_enabled: settings.tts_enabled,
    reorder_default_quantity: settings.reorder_default_quantity,
  }
}

/** Tylko pola różniące się od zapisanych (prefix porównywany po przycięciu spacji). */
export function changedSettings(form: SettingsValues, saved: SettingsValues): Partial<SettingsValues> {
  const changes: Partial<SettingsValues> = {}
  for (const key of SETTINGS_KEYS) {
    const value = key === 'prefix' ? form.prefix.trim() : form[key]
    if (value !== saved[key]) Object.assign(changes, { [key]: value })
  }
  return changes
}

/** Walidacja po stronie klienta; serwer i tak odrzuci błędne pola (422). */
export function validateSettings(form: SettingsValues): string | null {
  if (!PREFIX_PATTERN.test(form.prefix.trim())) return 'Prefix musi być jednym słowem (2–30 liter).'
  if (!Number.isInteger(form.default_minimum) || form.default_minimum < 0 || form.default_minimum > MAX_DEFAULT_MINIMUM) {
    return 'Domyślne minimum musi być liczbą całkowitą od 0 do 100 000.'
  }
  if (!Number.isInteger(form.reorder_default_quantity) || form.reorder_default_quantity < 1) {
    return 'Ilość w szkicu zamówienia musi być liczbą całkowitą większą od zera.'
  }
  return null
}

/** Konta czekające na zatwierdzenie na górze listy; poza tym kolejność z serwera (sortowanie stabilne). */
export function pendingFirst<U extends { role: string }>(users: readonly U[]): U[] {
  return users
    .map((user, index) => ({ user, index }))
    .sort((a, b) => Number(b.user.role === 'oczekujacy') - Number(a.user.role === 'oczekujacy') || a.index - b.index)
    .map(({ user }) => user)
}
