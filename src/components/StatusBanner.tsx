import type { AuthMode, StorageKind } from '@/lib/api'

type Props = {
  storage: StorageKind | null
  authMode: AuthMode | null
}

/** Ostrzeżenia o konfiguracji serwera na górze treści (dane tymczasowe, tryb bez logowania). */
export default function StatusBanner({ storage, authMode }: Props) {
  if (storage !== 'ephemeral' && authMode !== 'disabled' && authMode !== 'misconfigured') return null

  return (
    <div className="space-y-2">
      {storage === 'ephemeral' && (
        <p className="border border-[#ead9a9] bg-[#fffaf0] px-4 py-3 text-sm font-semibold text-[#805c12]" role="status">
          Dane tymczasowe: brak DATABASE_URL — zmiany znikną po restarcie serwera. Podłącz Supabase.
        </p>
      )}
      {authMode === 'misconfigured' && (
        <p className="border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm font-semibold text-[#8f3936]" role="alert">
          Logowanie skonfigurowane niepoprawnie — brakuje kluczy Supabase, więc serwer nie udostępnia danych.
        </p>
      )}
      {authMode === 'disabled' && <p className="text-xs text-[#70756f]">Tryb bez logowania (lokalnie)</p>}
    </div>
  )
}
