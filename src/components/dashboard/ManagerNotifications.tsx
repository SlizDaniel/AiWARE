import { refreshPersonalNotifications } from '@/lib/workTasksApi'
import { useState } from 'react'
import { apiErrorFromResponse, readApiJson } from '@/lib/api'
import type { ManagerNotifications as Notifications } from '@/lib/managerNotifications'
import type { SectionId } from '@/lib/sections'
import { useRemote } from './useRemote'
import { BlockError, cardClass, secondaryButton } from './ui'
async function fetchNotifications(signal: AbortSignal): Promise<Notifications> {
  const response = await fetch('/api/notifications', { signal, cache: 'no-store' })
  if (!response.ok) throw await apiErrorFromResponse(response)
  return readApiJson<Notifications>(response)
}
export default function ManagerNotifications({ refreshToken, onNavigate, onForbidden }: {
  refreshToken: string; onNavigate: (section: SectionId) => void; onForbidden: () => void
}) {
  const remote = useRemote(fetchNotifications, 'manager-notifications', refreshToken, onForbidden)
  const [showRead, setShowRead] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const data = remote.data
  const unread = data?.notifications.filter(n => !n.read) ?? []
  const visible = showRead ? (data?.notifications ?? []) : unread
  const markRead = async (ids: string[]) => {
    setSaving(true)
    setSaveError('')
    try {
      const response = await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      if (!response.ok) {
        if (response.status === 403) onForbidden()
        if (response.status === 409) remote.retry()
        throw await apiErrorFromResponse(response)
      }
      remote.retry()
      refreshPersonalNotifications()
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Nie udało się oznaczyć powiadomień.') }
    finally { setSaving(false) }
  }
  // Wszystko odczytane → karta znika z dashboardu; odczytane alerty nie wracają do listy.
  if (data && data.unread_count === 0) return null
  return <section className={`${cardClass} p-5 sm:p-6`} aria-label="Powiadomienia kierownika">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Powiadomienia kierownika</h2>
      <p role="status">{data ? `${data.unread_count} nieprzeczytanych · ${data.critical_count} pilnych` : remote.error ? '' : 'Ładowanie…'}</p>
    </div>
    <p className="mt-2 text-sm text-[#646b64]">Automatyczne alerty o zapasach i zamówieniach. Odczytane znikają z dashboardu; przeczytanie nie rozwiązuje problemu ani nie zmienia stanu magazynu.</p>
    {Boolean(remote.error) && <BlockError error={remote.error} fallback="Nie udało się pobrać powiadomień." onRetry={remote.retry} />}
    {saveError && <p role="alert" className="mt-2 text-red-700">{saveError}</p>}
    {data && <div className="my-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button className={secondaryButton} disabled={saving || remote.loading || unread.length === 0} onClick={() => void markRead(unread.map(n => n.id))}>Odczytaj wszystkie</button>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={showRead} onChange={e => setShowRead(e.target.checked)} /> Pokaż przeczytane</label>
    </div>}
    {data && <>
      {data.truncated && <p role="status">Pokazano pierwsze 100 alertów. Liczniki dotyczą tej listy.</p>}
      {!visible.length && <p className="py-3">Brak powiadomień do pokazania.</p>}
      <ul className="space-y-3">{visible.map(n => <li key={n.id} className={`border p-3 ${n.priority === 'critical' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'} ${n.read ? 'opacity-60' : ''}`}>
        <p className="font-semibold">{n.priority === 'critical' ? 'PILNE' : 'UWAGA'} · {n.title}</p>
        <p className="my-2 text-sm">{n.message}</p>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButton} onClick={() => onNavigate(n.target)}>Otwórz {n.target === 'stany' ? 'stany' : n.target === 'historia' ? 'historię' : 'kolejkę'}</button>
          {!n.read && <button className={secondaryButton} disabled={saving || remote.loading} onClick={() => void markRead([n.id])}>Oznacz jako przeczytane</button>}
        </div>
      </li>)}</ul>
    </>}
  </section>
}
