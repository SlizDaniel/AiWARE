import { readApiJson } from './api'
import type { CreateWorkTask, WorkTasksResponse } from './workTasks'
export const PERSONAL_NOTIFICATIONS_CHANGED = 'magazynier:personal-notifications'
export function refreshPersonalNotifications() { window.dispatchEvent(new Event(PERSONAL_NOTIFICATIONS_CHANGED)) }
export async function fetchWorkTasks(page: number, signal: AbortSignal): Promise<WorkTasksResponse> {
  return readApiJson(await fetch(`/api/tasks?page=${page}`,{signal,cache:'no-store'}))
}
export async function createTask(task: CreateWorkTask): Promise<void> {
  await readApiJson(await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(task)}))
  refreshPersonalNotifications()
}
export async function updateTask(id: string, action: 'read' | 'complete' | 'cancel'): Promise<void> {
  await readApiJson(await fetch(`/api/tasks/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}))
  refreshPersonalNotifications()
}
