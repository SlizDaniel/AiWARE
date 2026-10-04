import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initDb } from './db'
import { runCommand } from './commands'
import { parseCommand } from './parser'
import { createPgliteDb, type Db } from './sql'
import { createWorkTask, ensureWorkTasksSchema, updateWorkTask } from './workTasks'
import type { AppUser } from './types'

const manager: AppUser = { id: '11111111-1111-1111-1111-111111111111', email: 'manager@example.test', display_name: 'Kierownik', role: 'kierownik' }
const michal: AppUser = { id: '22222222-2222-2222-2222-222222222222', email: 'michal@example.test', display_name: 'Michał Kowalski', role: 'pracownik' }
const kuba: AppUser = { id: '33333333-3333-3333-3333-333333333333', email: 'kuba@example.test', display_name: 'Kuba Nowak', role: 'pracownik' }
let db: Db
beforeAll(async () => {
  db = await createPgliteDb(null)
  await initDb(db)
  await ensureWorkTasksSchema(db)
  for (const user of [manager, michal, kuba]) await db.query('INSERT INTO profiles(user_id,email,display_name,role) VALUES ($1,$2,$3,$4)', [user.id,user.email,user.display_name,user.role])
})
beforeEach(async () => {
  vi.stubEnv('LLM_MODE', 'offline')
  vi.stubEnv('DEMO_MODE', '')
  await db.exec('TRUNCATE work_tasks')
  await db.query('DELETE FROM profiles WHERE user_id NOT IN ($1,$2,$3)', [manager.id,michal.id,kuba.id])
})
afterAll(() => vi.unstubAllEnvs())
const command = async (text: string, user = manager) => {
  const response = await runCommand(db, text, { provider: null, role: user.role, actor: { id: user.id, name: user.display_name } })
  if (response.type === 'proposal') throw new Error('Task queries must never propose a write')
  return response
}
const assign = (user: AppUser, title: string, priority = 'normal') => createWorkTask(db, manager, { assigned_to: user.id, title, description: 'Strefa A1', priority })

it.each(['jakie zadanie ma michał', 'jakiego taska ma kuba?', 'jakie zadania ma Michał Kowalski?', 'co robi Kuba?'])( 'recognizes %s offline', text => {
  const parsed = parseCommand(text, [])
  expect(parsed?.tool).toBe('get_work_tasks')
  expect(parsed?.args.employee).not.toMatch(/[?!]/)
})

it('reads open assignments, descriptions and urgency without creating a proposal or audit', async () => {
  await assign(michal, 'Spakuj szkło', 'urgent')
  const { id } = await assign(michal, 'Stare zadanie')
  await updateWorkTask(db, michal, id, { action: 'complete' })
  const before = await db.query('SELECT * FROM audit_log')
  const response = await command('jakie zadanie ma michal?')
  expect(response).toMatchObject({ type: 'answer', tool: 'get_work_tasks', data: { employee_name: 'Michał Kowalski', tasks: [{ title: 'Spakuj szkło', priority: 'urgent' }] } })
  expect(response.text).toContain('Strefa A1')
  expect(response.text).toContain('pilne')
  expect(response.text).not.toContain('Stare zadanie')
  expect(await db.query('SELECT * FROM audit_log')).toEqual(before)
  expect(await db.query('SELECT * FROM proposals')).toEqual([])
})

it('reports no open tasks and unknown people', async () => {
  expect((await command('jakiego taska ma kuba')).text).toContain('Kuba Nowak nie ma otwartych zadań')
  expect((await command('jakie zadanie ma nieznany')).text).toContain('Nie znaleziono pracownika')
})

it('clarifies duplicate first names instead of mixing their assignments', async () => {
  await db.query("INSERT INTO profiles(user_id,email,display_name,role) VALUES ('44444444-4444-4444-4444-444444444444','other@example.test','Michał Nowak','pracownik')")
  expect(await command('jakie zadanie ma Michał')).toMatchObject({ type: 'clarify', message: expect.stringContaining('Podaj imię i nazwisko') })
  expect(await command('jakie zadanie ma Michał Kowalski')).toMatchObject({ type: 'answer', data: { employee_name: michal.display_name } })
})

it('workers see their own tasks and cannot read another worker by name', async () => {
  await assign(michal, 'Prywatny przydział')
  await assign(kuba, 'Policz kartony')
  expect(await command('jakie mam zadania?', kuba)).toMatchObject({ type: 'answer', data: { tasks: [{ title: 'Policz kartony' }] } })
  const denied = await command('jakie zadanie ma Michał', kuba)
  expect(denied.text).not.toContain('Prywatny przydział')
  expect(denied).toMatchObject({ data: { tasks: [] } })
})

it('the LLM calls the same registered tool and the server enforces visibility', async () => {
  await assign(kuba, 'Policz kartony')
  vi.stubEnv('LLM_MODE', 'llm')
  const response = await runCommand(db, 'jakiego taska ma kuba', {
    actor: { id: manager.id, name: manager.display_name }, role: manager.role,
    provider: { async interpret(_text, schemas) {
      expect(schemas.some(tool => tool.function.name === 'get_work_tasks')).toBe(true)
      return { toolCall: { name: 'get_work_tasks', arguments: { employee: 'Kuba' } }, clarification: null }
    } },
  })
  expect(response).toMatchObject({ type: 'answer', data: { tasks: [{ title: 'Policz kartony' }] } })
})
