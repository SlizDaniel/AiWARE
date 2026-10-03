import type { AuthMode, StorageKind } from '@/lib/api'
import { Notice } from './ui/feedback'

type Props = {
  storage: StorageKind | null
  authMode: AuthMode | null
}

/** Ostrzeżenia o konfiguracji serwera na górze treści (dane tymczasowe, logowanie bez kluczy). */
export default function StatusBanner({ storage, authMode }: Props) {
  if (storage !== 'ephemeral' && authMode !== 'misconfigured') return null

  return (
    <div className="space-y-2">
      {storage === 'ephemeral' && (
        <Notice tone="warn" role="status" title="Dane tymczasowe">
          Brak DATABASE_URL — zmiany znikną po restarcie serwera. Podłącz Supabase.
        </Notice>
      )}
      {authMode === 'misconfigured' && (
        <Notice tone="alarm" role="alert" title="Logowanie skonfigurowane niepoprawnie">
          Brakuje kluczy Supabase, więc serwer nie udostępnia danych.
        </Notice>
      )}
    </div>
  )
}
