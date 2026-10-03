import type { Metadata } from 'next'
import LoginForm from './LoginForm'

export const metadata: Metadata = {
  title: 'Logowanie — MAGAZYNIER',
}

/** Only same-origin relative paths; anything else falls back to '/'. */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const next = safeNext(typeof params.next === 'string' ? params.next : undefined)
  return <LoginForm callbackError={error} next={next} />
}
