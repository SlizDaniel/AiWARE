import { afterAll,beforeAll,beforeEach,describe,expect,test,vi } from 'vitest'
import { createPgliteDb,type Db } from '@/server/sql'
import { initDb,getDataVersion } from '@/server/db'
import { ensureWorkTasksSchema } from '@/server/workTasks'
import { setSessionReader } from '@/server/auth'
import { GET,POST } from '@/app/api/tasks/route'
import { PATCH } from '@/app/api/tasks/[id]/route'
const BOSS='11111111-1111-4111-8111-111111111111'
const WORKER='22222222-2222-4222-8222-222222222222'
const OTHER='33333333-3333-4333-8333-333333333333'
const PENDING='44444444-4444-4444-8444-444444444444'
let actor=BOSS
let db:Db
const store=globalThis as typeof globalThis & {__magazynierDb?:Promise<Db>}
beforeAll(async()=>{db=await createPgliteDb(null);await initDb(db);await ensureWorkTasksSchema(db);store.__magazynierDb=Promise.resolve(db)})
beforeEach(async()=>{
  vi.unstubAllEnvs();vi.stubEnv('AUTH_DISABLED','0');vi.stubEnv('DEMO_MODE','0')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','test')
  await db.exec('TRUNCATE work_tasks, profiles, audit_log RESTART IDENTITY CASCADE')
  for(const [id,name,role] of [[BOSS,'Szef','kierownik'],[WORKER,'Anna','pracownik'],[OTHER,'Jan','pracownik'],[PENDING,'Nowy','oczekujacy']]){
    await db.query('INSERT INTO profiles(user_id,email,display_name,role) VALUES($1,$2,$3,$4)',[id,`${name}@example.test`,name,role])
  }
  actor=BOSS
  setSessionReader(async()=>({id:actor,email:'test@example.test',metadata:{}}))
})
afterAll(()=>{store.__magazynierDb=undefined;setSessionReader(null);vi.unstubAllEnvs()})
const get=(page=1)=>GET(new Request(`http://test/api/tasks?page=${page}`))
const post=(body:unknown)=>POST(new Request('http://test/api/tasks',{method:'POST',body:JSON.stringify(body)}))
const patch=(id:string,action:string)=>PATCH(new Request(`http://test/api/tasks/${id}`,{method:'PATCH',body:JSON.stringify({action})}),{params:Promise.resolve({id})})
const payload={title:'Sprawdź kartony',description:'Policz zapas w strefie A',assigned_to:WORKER,priority:'urgent'}
const create=async()=>{const response=await post(payload);expect(response.status).toBe(201);return (await response.json()).id as string}
describe('assigned tasks and employee notifications',()=>{
  test('manager assigns task; only assignee gets unread notification and sees private description',async()=>{
    const before=await getDataVersion(db)
    const id=await create()
    expect(await getDataVersion(db)).toBe(before+1)
    actor=WORKER
    const response=await get();expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body=await response.json()
    expect(body).toMatchObject({unread_count:1,open_count:1,page:1,has_more:false})
    expect(body.tasks[0]).toMatchObject({id,title:payload.title,description:payload.description,assignee_name:'Anna',creator_name:'Szef',status:'assigned',read_at:null})
    actor=OTHER
    expect(await (await get()).json()).toMatchObject({tasks:[],unread_count:0,open_count:0})
    expect((await patch(id,'read')).status).toBe(404)
    expect((await patch(id,'complete')).status).toBe(404)
  })
  test('read persists and does not complete; complete is idempotent and does not alter inventory/audit',async()=>{
    const stock=await db.query('SELECT id,quantity FROM items ORDER BY id')
    const id=await create();actor=WORKER
    expect((await patch(id,'read')).status).toBe(200)
    expect(await (await get()).json()).toMatchObject({unread_count:0,open_count:1})
    expect((await patch(id,'complete')).status).toBe(200)
    const version=await getDataVersion(db)
    expect((await patch(id,'complete')).status).toBe(200)
    expect(await getDataVersion(db)).toBe(version)
    actor=BOSS
    const body=await (await get()).json()
    expect(body.tasks[0]).toMatchObject({status:'done'})
    expect(body.tasks[0].done_at).not.toBeNull()
    expect(await db.query('SELECT id,quantity FROM items ORDER BY id')).toEqual(stock)
    expect(await db.query('SELECT id FROM audit_log')).toEqual([])
  })
  test('only manager can cancel, cancelled task no longer notifies and cannot be completed',async()=>{
    const id=await create();actor=WORKER
    expect((await patch(id,'cancel')).status).toBe(403)
    actor=BOSS
    expect((await patch(id,'read')).status).toBe(403)
    expect((await patch(id,'cancel')).status).toBe(200)
    expect((await patch(id,'cancel')).status).toBe(200)
    actor=WORKER
    expect(await (await get()).json()).toMatchObject({unread_count:0,open_count:0})
    expect((await patch(id,'complete')).status).toBe(409)
  })
  test('rejects wrong recipient and invalid payload; worker cannot create tasks',async()=>{
    for(const body of [null,{}, {...payload,title:' '},{...payload,title:'x'.repeat(121)},{...payload,description:'x'.repeat(2001)},
      {...payload,assigned_to:BOSS},{...payload,assigned_to:PENDING},{...payload,assigned_to:'not-a-uuid'},{...payload,priority:'unknown'}]){
      expect((await post(body)).status).toBe(422)
    }
    actor=WORKER
    const forbidden=await post(payload);expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('cache-control')).toBe('private, no-store')
    actor=PENDING
    expect((await get()).status).toBe(403)
    setSessionReader(async()=>null)
    expect((await get()).status).toBe(401)
  })
  test('pagination does not hide total unread count; migration is idempotent and RLS enabled',async()=>{
    await ensureWorkTasksSchema(db)
    await db.query(`INSERT INTO work_tasks(id,title,description,assigned_to,created_by,priority)
      SELECT gen_random_uuid(),'Zadanie ' || g,'',$1::uuid,$2::uuid,'normal' FROM generate_series(1,51) g`,[WORKER,BOSS])
    actor=WORKER
    const first=await (await get()).json();expect(first.tasks).toHaveLength(50);expect(first).toMatchObject({unread_count:51,has_more:true})
    const second=await (await get(2)).json();expect(second.tasks).toHaveLength(1);expect(second.unread_count).toBe(51)
    actor=BOSS;expect((await (await get()).json()).unread_count).toBe(0)
    expect((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='work_tasks'"))[0].relrowsecurity).toBe(true)
    expect((await GET(new Request('http://test/api/tasks?page=0'))).status).toBe(422)
  })
})
