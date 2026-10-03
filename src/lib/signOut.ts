/** Wylogowanie z Supabase i powrót do /login (także przy błędzie — sesję i tak odrzuci serwer). */
export async function signOutAndRedirect(): Promise<void> {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    await createClient().auth.signOut()
  } catch {
    /* brak konfiguracji lub sieci — i tak przechodzimy do logowania */
  } finally {
    window.location.href = '/login'
  }
}
