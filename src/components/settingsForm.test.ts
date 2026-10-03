import { expect, test } from 'vitest'
import type { AppSettings, SettingsValues } from '@/lib/api'
import { changedSettings, settingsValues, validateSettings } from './settingsForm'

const saved: SettingsValues = {
  prefix: 'Magu',
  mode: 'llm',
  adapter: 'database',
  default_minimum: 0,
  voice_mode: 'push_to_talk',
  tts_enabled: false,
  reorder_default_quantity: 50,
}

test('settingsValues keeps only the seven editable fields', () => {
  const settings: AppSettings = {
    ...saved,
    version: '0.3.0',
    mode_status: { demo_mode: false, mode: 'llm', effective_mode: 'offline', llm_available: false, warning: null },
    ai_usage: {
      llm_model: 'gemini',
      llm_provider: 'Google',
      llm_enabled: false,
      stt_model: 'gemini',
      stt_provider: 'Google',
      stt_enabled: false,
      disclosure: 'AI',
    },
  }
  expect(settingsValues(settings)).toEqual(saved)
})

test('only changed fields are sent and the prefix is compared trimmed', () => {
  expect(changedSettings({ ...saved }, saved)).toEqual({})
  expect(changedSettings({ ...saved, prefix: ' Magu ' }, saved)).toEqual({})
  expect(changedSettings({ ...saved, prefix: ' Gosiu ', voice_mode: 'text', tts_enabled: true }, saved)).toEqual({
    prefix: 'Gosiu',
    voice_mode: 'text',
    tts_enabled: true,
  })
  expect(changedSettings({ ...saved, voice_mode: 'wake_word' }, saved)).toEqual({ voice_mode: 'wake_word' })
  expect(changedSettings({ ...saved, adapter: 'file_import', default_minimum: 3 }, saved)).toEqual({
    adapter: 'file_import',
    default_minimum: 3,
  })
})

test('prefix must be one word of 2–30 letters, Polish letters included', () => {
  expect(validateSettings({ ...saved, prefix: 'Gosiu' })).toBeNull()
  expect(validateSettings({ ...saved, prefix: ' Żółć ' })).toBeNull()
  for (const prefix of ['M', 'Hej Magu', 'Magu1', 'Magu,', 'x'.repeat(31), '']) {
    expect(validateSettings({ ...saved, prefix })).toBe('Prefix musi być jednym słowem (2–30 liter).')
  }
})

test('numeric fields are integers within range', () => {
  expect(validateSettings({ ...saved, default_minimum: 100000 })).toBeNull()
  expect(validateSettings({ ...saved, default_minimum: -1 })).toMatch(/minimum/)
  expect(validateSettings({ ...saved, default_minimum: 100001 })).toMatch(/minimum/)
  expect(validateSettings({ ...saved, default_minimum: Number.NaN })).toMatch(/minimum/)
  expect(validateSettings({ ...saved, default_minimum: 1.5 })).toMatch(/minimum/)
  expect(validateSettings({ ...saved, reorder_default_quantity: 0 })).toMatch(/szkicu zamówienia/)
  expect(validateSettings({ ...saved, reorder_default_quantity: Number.NaN })).toMatch(/szkicu zamówienia/)
})
