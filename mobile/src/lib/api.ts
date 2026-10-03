import { createApi } from './client'
import { apiUrl, configurationError, supabase } from './supabase'

export const api = !configurationError ? createApi(apiUrl, async () => {
  const { data, error } = await supabase!.auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}) : null
