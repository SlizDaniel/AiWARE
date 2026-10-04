import { normalizeSpeech } from '@/lib/speech'
import { HttpError } from './http'
import type { Actor } from './db'
import type { Db } from './sql'
import type { Role } from './types'
import { ensureWorkTasksSchema } from './workTasks'

/** Resolve names only within the caller's existing task visibility. */
export async function queryWorkerTasks(db: Db, employee: string | undefined, actor: Actor, role?: Role): Promise<Record<string, unknown>> {
  if (role !== 'pracownik' && role !== 'kierownik') throw new HttpError(403, 'Brak dostępu do zadań.')
  const people = await db.query<{ id: string; name: string }>(`
    SELECT user_id::text AS id, coalesce(nullif(display_name,''),email) AS name
    FROM profiles WHERE role IN ('pracownik','kierownik') AND ($1 OR user_id::text=$2)`, [role === 'kierownik', actor.id])
  const name = employee?.trim()
  const matches = name ? people.filter(person => {
    const wanted = normalizeSpeech(name)
    const full = normalizeSpeech(person.name)
    return full === wanted || (!wanted.includes(' ') && full.split(' ').includes(wanted))
  }) : people.filter(person => person.id === actor.id)
  if (!matches.length) return { message: 'Nie znaleziono pracownika w dostępnym zakresie zadań.', tasks: [] }
  if (matches.length > 1) return { clarification: `Pasuje kilka osób: ${matches.map(person => person.name).join(', ')}. Podaj imię i nazwisko.` }
  const person = matches[0]
  await ensureWorkTasksSchema(db)
  const tasks = await db.query<{ id: string; title: string; description: string; priority: string }>(`
    SELECT id::text, title, description, priority FROM work_tasks
    WHERE assigned_to=$1::uuid AND status='assigned'
    ORDER BY (priority='urgent') DESC, created_at DESC, id DESC`, [person.id])
  return { employee_name: person.name, tasks, message: tasks.length
    ? `Otwarte zadania — ${person.name}: ` + tasks.map(task => `${task.title}${task.priority === 'urgent' ? ' (pilne)' : ''}${task.description ? ` — ${task.description}` : ''}`).join('; ') + '.'
    : `${person.name} nie ma otwartych zadań.` }
}
