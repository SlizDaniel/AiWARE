import TaskHelpPanel from './TaskHelpPanel'
import { useState } from 'react'
import { fetchUsers, type UserAccount } from '@/lib/api'
import type { WorkTasksResponse } from '@/lib/workTasks'
import { createTask, fetchWorkTasks, updateTask } from '@/lib/workTasksApi'
import { useRemote } from './dashboard/useRemote'
import { BlockError, inputClass, labelClass, secondaryButton } from './dashboard/ui'
import { panelClass } from './ui/styles'
export default function WorkTasksPanel({canManage,userId,updateTick}:{canManage:boolean;userId:string;updateTick:number}) {
  const [page,setPage] = useState(1)
  const [refresh,setRefresh] = useState(0)
  const feed = useRemote<WorkTasksResponse>(signal => fetchWorkTasks(page,signal),`${userId}:${canManage}:${page}`,`${updateTick}:${refresh}`)
  const people = useRemote<UserAccount[]>(canManage ? () => fetchUsers() : null,'task-assignees',updateTick)
  const workers = people.data?.filter(user => user.role === 'pracownik') ?? []
  const [title,setTitle] = useState('')
  const [description,setDescription] = useState('')
  const [assignee,setAssignee] = useState('')
  const [priority,setPriority] = useState<'normal'|'urgent'>('normal')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const run = async (operation: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true);setError('');setNotice('')
    try { await operation();setRefresh(value => value+1);setNotice(success) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Operacja nie powiodła się.'); feed.retry() }
    finally { setBusy(false) }
  }
  return <section className={`${panelClass} p-5 sm:p-6`} aria-label="Zadania pracowników">
    <h2 className="text-lg font-semibold">{canManage ? 'Zadania pracowników' : 'Moje zadania'}</h2>
    <p className="mt-2 text-sm text-ink-2">{canManage ? 'Przydziel zadanie aktywnemu pracownikowi. Zobaczy powiadomienie na swoim koncie.' : 'Nowe przydziały są oznaczone jako nieprzeczytane. Wykonanie zadania nie zmienia automatycznie zapasu.'}</p>
    {canManage && <form className="my-4 grid gap-3" onSubmit={event => {
      event.preventDefault()
      void run(async () => { await createTask({title,description,assigned_to:assignee,priority});setTitle('');setDescription('') },'Zadanie przydzielone. Pracownik otrzyma powiadomienie.')
    }}>
      <label className={labelClass}>Pracownik<select className={inputClass} value={assignee} onChange={event => setAssignee(event.target.value)} required>
        <option value="">Wybierz pracownika</option>{workers.map(user => <option key={user.id} value={user.id}>{user.display_name || user.email}</option>)}
      </select></label>
      {Boolean(people.error) && <BlockError error={people.error} fallback="Nie udało się pobrać pracowników." onRetry={people.retry} />}
      {!people.loading && !people.error && !workers.length && <p>Brak aktywnych pracowników. Kierownik zatwierdza konta w Ustawieniach.</p>}
      <label className={labelClass}>Tytuł zadania<input className={inputClass} value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required /></label>
      <label className={labelClass}>Opis zadania<textarea className={inputClass} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} /></label>
      <label className={labelClass}>Priorytet<select className={inputClass} value={priority} onChange={event => setPriority(event.target.value as 'normal'|'urgent')}><option value="normal">Normalny</option><option value="urgent">Pilny</option></select></label>
      <button className={secondaryButton} disabled={busy || !workers.some(user => user.id === assignee)}>Przydziel zadanie</button>
    </form>}
    {error && <p role="alert" className="my-3 text-red-700">{error}</p>}
    {notice && <p role="status" className="my-3">{notice}</p>}
    {Boolean(feed.error) && <BlockError error={feed.error} fallback="Nie udało się pobrać zadań." onRetry={feed.retry} />}
    {feed.loading && <p>Odświeżam zadania…</p>}
    {feed.data && !feed.stale && <>
      <p className="my-3">Otwarte: {feed.data.open_count}{!canManage && ` · Nowe: ${feed.data.unread_count}`}</p>
      {!feed.data.tasks.length && <p>Brak zadań.</p>}
      <ul className="space-y-3">{feed.data.tasks.map(task => <li key={task.id} className="rounded-md border border-line p-4">
        <p className="font-semibold">{task.priority === 'urgent' && 'PILNE · '}{task.title}{!canManage && task.status === 'assigned' && !task.read_at && ' · NOWE'}</p>
        <p className="my-2 whitespace-pre-wrap text-sm">{task.description}</p>
        <p className="text-sm text-ink-2">Dla: {task.assignee_name} · Od: {task.creator_name} · {task.status === 'assigned' ? 'Przydzielone' : task.status === 'done' ? 'Wykonane' : 'Anulowane'}</p>
        {task.status === 'assigned' && <div className="mt-3 flex flex-wrap gap-2">
          {canManage ? <button className={secondaryButton} disabled={busy} onClick={() => void run(() => updateTask(task.id,'cancel'),'Zadanie anulowane.')}>Anuluj zadanie</button> : <>
            {!task.read_at && <button className={secondaryButton} disabled={busy} onClick={() => void run(() => updateTask(task.id,'read'),'Powiadomienie przeczytane.')}>Oznacz jako przeczytane</button>}
            <button className={secondaryButton} disabled={busy} onClick={() => void run(() => updateTask(task.id,'complete'),'Zadanie oznaczone jako wykonane.')}>Oznacz jako wykonane</button>
          </>}
        </div>}
        {task.status === 'assigned' && <TaskHelpPanel key={`${task.id}:${updateTick}:${refresh}`} id={task.id} />}
      </li>)}</ul>
      <div className="mt-4 flex gap-3"><button className={secondaryButton} disabled={page===1 || feed.loading} onClick={() => setPage(value => value-1)}>Poprzednia</button><span>Strona {page}</span><button className={secondaryButton} disabled={!feed.data.has_more || feed.loading} onClick={() => setPage(value => value+1)}>Następna</button></div>
    </>}
  </section>
}
