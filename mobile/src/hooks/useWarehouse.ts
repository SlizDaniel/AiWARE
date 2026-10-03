import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { Api } from '../lib/client'
import type { AppSettings, CurrentUser, Health, HistoryEntry, Item, Procedure, ReorderDraft, Zone } from '../lib/contracts'

export type Warehouse = {
  user: CurrentUser; health: Health; settings: AppSettings; items: Item[]; zones: Zone[];
  history: HistoryEntry[]; procedures: Procedure[]; orders: ReorderDraft[];
}

export function useWarehouse(api: Api) {
  const [data, setData] = useState<Warehouse | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(false)
  const version = useRef<number | null>(null)
  const flight = useRef<Promise<void> | null>(null)
  const queued = useRef(false)
  const failed = useRef(false)

  const reload = useCallback((): Promise<void> => {
    queued.current = true
    if (flight.current) return flight.current
    setRefreshing(true)
    flight.current = (async () => {
      do {
        queued.current = false
        try {
          // Read version before the snapshot: a write during the read is caught by the next poll.
          const nextVersion = await api.version()
          // Fetch sequentially: concurrent reads can stall the development backend.
          const me = await api.me()
          const health = await api.health()
          const settings = await api.settings()
          const items = await api.stock()
          const zones = await api.zones()
          const history = await api.history()
          const procedures = await api.procedures()
          const orders = await api.orders()
          if (!me.user) throw new Error('Brak profilu użytkownika.')
          if (alive.current) {
            version.current = nextVersion
            setData({ user: me.user, health, settings, items, zones, history, procedures, orders })
            failed.current = false
            setError('')
          }
        } catch (error) {
          failed.current = true
          if (alive.current) setError(error instanceof Error ? error.message : 'Nie udało się pobrać danych.')
        }
      } while (queued.current && alive.current)
    })().finally(() => {
      flight.current = null
      if (alive.current) setRefreshing(false)
    })
    return flight.current
  }, [api])

  useEffect(() => {
    alive.current = true
    void reload()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        if (AppState.currentState === 'active' || AppState.currentState === null) {
          const next = await api.version()
          if (next !== version.current || failed.current) await reload()
          else if (alive.current) setError('')
        }
      } catch (error) {
        failed.current = true
        if (alive.current) setError(error instanceof Error ? error.message : 'Utracono połączenie.')
      }
      if (alive.current) timer = setTimeout(() => void poll(), 3000)
    }
    timer = setTimeout(() => void poll(), 3000)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void reload()
    })
    return () => { alive.current = false; clearTimeout(timer); subscription.remove() }
  }, [api, reload])

  return { data, error, refreshing, reload }
}
