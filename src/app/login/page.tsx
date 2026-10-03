import type { Metadata } from 'next'
import { safeNextPath } from '@/lib/safeRedirect'
import LoginForm from './LoginForm'

export const metadata: Metadata = {
  title: 'Logowanie — MAGAZYNIER',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const next = safeNextPath(typeof params.next === 'string' ? params.next : undefined)
  return <LoginForm callbackError={error} next={next} />
}
