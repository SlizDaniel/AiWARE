import { useEffect, useState } from 'react'
import { readApiJson, type Role } from '@/lib/api'
import type { ManagerNotifications } from '@/lib/managerNotifications'
import { fetchWorkTasks, PERSONAL_NOTIFICATIONS_CHANGED } from '@/lib/workTasksApi'
import { useRemote } from './dashboard/useRemote'
/** Always mounted: counts refresh even while the dashboard/tasks view is closed. */
export function useNotificationCounts(userId: string | null, role: Role | null, updateTick: number, onForbidden: () => void) {
  const [refresh,setRefresh] = useState(0)
  useEffect(() => {
    const reload = () => setRefresh(value => value+1)
    const visible = () => { if (!document.hidden) reload() }
    const timer = setInterval(visible,60000)
    window.addEventListener(PERSONAL_NOTIFICATIONS_CHANGED,reload)
    document.addEventListener('visibilitychange',visible)
    return () => { clearInterval(timer); window.removeEventListener(PERSONAL_NOTIFICATIONS_CHANGED,reload); document.removeEventListener('visibilitychange',visible) }
  },[])
  const enabled = Boolean(userId && (role === 'kierownik' || role === 'pracownik'))
  const remote = useRemote(enabled ? async signal => {
    if (role === 'kierownik') {
      const notices = await readApiJson<ManagerNotifications>(await fetch('/api/notifications',{signal,cache:'no-store'}))
      return {dashboard:notices.unread_count,tasks:0}
    }
    return {dashboard:0,tasks:(await fetchWorkTasks(1,signal)).unread_count}
  } : null,`${userId}:${role}`,`${updateTick}:${refresh}`,onForbidden)
  return remote.stale || remote.error ? {dashboard:0,tasks:0} : remote.data ?? {dashboard:0,tasks:0}
}
