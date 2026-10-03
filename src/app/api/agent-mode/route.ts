import { bumpDataVersion } from '@/server/db'
import { HttpError, readJson, route } from '@/server/http'
import { session } from '@/server/session'
import { getAgentModeStatus, setAgentMode } from '@/server/settings'
import type { AgentMode } from '@/server/types'

const MODES: AgentMode[] = ['llm', 'offline', 'mock']

export const GET = route(async () => {
  const { db } = await session()
  return Response.json(await getAgentModeStatus(db))
})

export const PUT = route(async (request: Request) => {
  const { db } = await session('kierownik')
  const body = await readJson<{ mode?: unknown }>(request)
  if (!MODES.includes(body.mode as AgentMode)) throw new HttpError(422, 'Tryb musi być jednym z: llm, offline, mock.')
  await setAgentMode(db, body.mode as AgentMode)
  await bumpDataVersion(db)
  return Response.json(await getAgentModeStatus(db))
})
