import { randomUUID } from 'node:crypto'
import type { CreateWorkTask, WorkTask, WorkTasksResponse } from '@/lib/workTasks'
import { bumpDataVersion } from './db'
import { ISO_TS, positiveInt } from './dashboard'
import { HttpError } from './http'
import type { Db } from './sql'
import type { AppUser } from './types'

/** Independent, lazy migration avoids changing the shared inventory schema version. */
export async function ensureWorkTasksSchema(db: Db): Promise<void> {
  const current = async (tx: Db) => (await tx.query<{ found: boolean }>("SELECT to_regclass('work_tasks') IS NOT NULL AS found"))[0].found
  if (await current(db)) return
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(724249)')
    if (await current(tx)) return
    await tx.exec(`CREATE TABLE IF NOT EXISTS work_tasks (
      id UUID PRIMARY KEY, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
      assigned_to UUID NOT NULL REFERENCES profiles(user_id), created_by UUID NOT NULL REFERENCES profiles(user_id),
      priority TEXT NOT NULL CHECK (priority IN ('normal','urgent')),
      status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','done','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ NULL, done_at TIMESTAMPTZ NULL);
      CREATE INDEX IF NOT EXISTS work_tasks_assignee_idx ON work_tasks (assigned_to, status, created_at DESC);
      ALTER TABLE work_tasks ENABLE ROW LEVEL SECURITY;`)
  })
}
const columns = `t.id::text, t.title, t.description, t.priority, t.status, t.assigned_to::text, t.created_by::text,
  coalesce(nullif(a.display_name,''),a.email) AS assignee_name, coalesce(nullif(c.display_name,''),c.email) AS creator_name,
  ${ISO_TS('t.created_at')} AS created_at, ${ISO_TS('t.read_at')} AS read_at, ${ISO_TS('t.done_at')} AS done_at`
const joins = 'FROM work_tasks t JOIN profiles a ON a.user_id=t.assigned_to JOIN profiles c ON c.user_id=t.created_by'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listWorkTasks(db: Db, user: AppUser, query: URLSearchParams): Promise<WorkTasksResponse> {
  const page = positiveInt(query.get('page') ?? '1', 'page', 100000)
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    const manager = user.role === 'kierownik'
    const params = [manager, user.id]
    const [{ unread_count, open_count }] = await tx.query<{ unread_count: number; open_count: number }>(`
      SELECT count(*) FILTER (WHERE status='assigned' AND read_at IS NULL AND NOT $1)::int AS unread_count,
      count(*) FILTER (WHERE status='assigned')::int AS open_count FROM work_tasks WHERE $1 OR assigned_to=$2::uuid`, params)
    const rows = await tx.query<WorkTask>(`SELECT ${columns} ${joins} WHERE $1 OR t.assigned_to=$2::uuid
      ORDER BY (t.status='assigned') DESC, (t.priority='urgent') DESC, t.created_at DESC, t.id DESC LIMIT 51 OFFSET $3`, [...params, (page-1)*50])
    return { tasks: rows.slice(0,50), unread_count, open_count, page, has_more: rows.length > 50 }
  })
}
export function taskPayload(body: unknown): CreateWorkTask {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422,'Podaj dane zadania.')
  const value = body as Record<string, unknown>
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (!title || title.length > 120 || description.length > 2000 || (value.description !== undefined && typeof value.description !== 'string')
      || typeof value.assigned_to !== 'string' || !uuid.test(value.assigned_to) || !['normal','urgent'].includes(String(value.priority))) {
    throw new HttpError(422,'Podaj tytuł (1–120 znaków), opis do 2000 znaków, pracownika i priorytet normal/urgent.')
  }
  return { title, description, assigned_to: value.assigned_to, priority: value.priority as CreateWorkTask['priority'] }
}
export async function createWorkTask(db: Db, user: AppUser, body: unknown): Promise<{ id: string }> {
  if (user.role !== 'kierownik') throw new HttpError(403,'Zadania przydziela kierownik.')
  const task = taskPayload(body)
  return db.transaction(async tx => {
    const [assignee] = await tx.query<{ role: string }>('SELECT role FROM profiles WHERE user_id=$1::uuid FOR UPDATE',[task.assigned_to])
    if (assignee?.role !== 'pracownik') throw new HttpError(422,'Wybierz aktywne konto pracownika.')
    const id = randomUUID()
    await tx.query('INSERT INTO work_tasks (id,title,description,assigned_to,created_by,priority) VALUES ($1,$2,$3,$4,$5,$6)',
      [id,task.title,task.description,task.assigned_to,user.id,task.priority])
    await bumpDataVersion(tx)
    return { id }
  })
}
export async function updateWorkTask(db: Db, user: AppUser, id: string, body: unknown): Promise<void> {
  if (!uuid.test(id)) throw new HttpError(404,'Nie ma takiego zadania.')
  const action = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string,unknown>).action : null
  if (!['read','complete','cancel'].includes(String(action))) throw new HttpError(422,'action: read, complete albo cancel.')
  await db.transaction(async tx => {
    const [task] = await tx.query<{ assigned_to: string; status: string; read_at: unknown }>(
      'SELECT assigned_to::text,status,read_at FROM work_tasks WHERE id=$1::uuid FOR UPDATE',[id])
    if (!task || (user.role !== 'kierownik' && task.assigned_to !== user.id)) throw new HttpError(404,'Nie ma takiego zadania.')
    if (action === 'cancel' ? user.role !== 'kierownik' : user.role !== 'pracownik' || task.assigned_to !== user.id) {
      throw new HttpError(403,'Nie możesz wykonać tej operacji na zadaniu.')
    }
    if ((action === 'complete' && task.status === 'done') || (action === 'cancel' && task.status === 'cancelled')) return
    if (task.status !== 'assigned') throw new HttpError(409,'Zadanie jest już zakończone lub anulowane.')
    if (action === 'read') {
      if (task.read_at) return
      await tx.query('UPDATE work_tasks SET read_at=now() WHERE id=$1::uuid',[id])
    } else if (action === 'complete') await tx.query("UPDATE work_tasks SET status='done',read_at=coalesce(read_at,now()),done_at=now() WHERE id=$1::uuid",[id])
    else await tx.query("UPDATE work_tasks SET status='cancelled' WHERE id=$1::uuid",[id])
    await bumpDataVersion(tx)
  })
}
