import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { isAbortError } from '@/lib/dashboardApi'

export type Remote<T> = {
  /** ostatnie dobre dane (także podczas odświeżania i po błędzie odświeżenia tego samego zapytania) */
  data: T | null
  loading: boolean
  error: unknown
  /** dane dotyczą innego zapytania niż bieżące (np. trwa ładowanie po zmianie filtrów) */
  stale: boolean
  fetchedAt: number | null
  retry: () => void
}

type Snapshot<T> = {
  data: T | null
  dataKey: string | null
  doneId: string | null
  error: unknown
  errorId: string | null
  fetchedAt: number | null
}

/**
 * Jedno zapytanie dashboardu: `key` opisuje parametry, `refreshToken` wymusza ponowne pobranie.
 * Nieaktualne odpowiedzi są przerywane AbortControllerem i ignorowane. Stan ustawiany tylko
 * w callbackach obietnicy (ładowanie wynika z porównania identyfikatorów żądań).
 */
export function useRemote<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  key: string,
  refreshToken: string | number,
  onForbidden?: () => void,
): Remote<T> {
  const [retries, setRetries] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    data: null,
    dataKey: null,
    doneId: null,
    error: null,
    errorId: null,
    fetchedAt: null,
  })
  const loadRef = useRef(load)
  const forbiddenRef = useRef(onForbidden)
  useEffect(() => {
    loadRef.current = load
    forbiddenRef.current = onForbidden
  })

  const enabled = load !== null
  const requestId = `${key}|${refreshToken}|${retries}`

  useEffect(() => {
    const run = loadRef.current
    if (!enabled || !run) return
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return
        setSnapshot({ data, dataKey: key, doneId: requestId, error: null, errorId: null, fetchedAt: Date.now() })
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setSnapshot((current) => ({ ...current, doneId: requestId, error, errorId: requestId }))
        if (error instanceof ApiError && error.status === 403) forbiddenRef.current?.()
      },
    )
    return () => controller.abort()
  }, [enabled, key, requestId])

  const loading = enabled && snapshot.doneId !== requestId
  const sameQuery = snapshot.dataKey === key
  return {
    data: enabled && (sameQuery || loading) ? snapshot.data : null,
    loading,
    error: enabled && snapshot.errorId === requestId ? snapshot.error : null,
    stale: !sameQuery,
    fetchedAt: snapshot.fetchedAt,
    retry: () => setRetries((value) => value + 1),
  }
}
