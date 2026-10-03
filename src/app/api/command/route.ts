import { actorOf } from '@/server/auth'
import { runCommand } from '@/server/commands'
import { HttpError, readJson, route } from '@/server/http'
import { llmConfigured, providerFromEnv } from '@/server/llm'
import { enforceRateLimit, RATE_LIMITS } from '@/server/rateLimit'
import { session } from '@/server/session'

// LLM budget is 15 s; leave headroom for the database round trips.
export const maxDuration = 30

const MAX_COMMAND_LENGTH = 2000

export const POST = route(async (request: Request) => {
  const { db, user } = await session()
  const body = await readJson<{ text?: unknown }>(request)
  if (typeof body.text !== 'string') throw new HttpError(422, 'Pole „text” musi być tekstem.')
  if (body.text.length > MAX_COMMAND_LENGTH) throw new HttpError(422, 'Komenda jest za długa (limit 2000 znaków).')
  await enforceRateLimit(db, `command:${user.id}`, RATE_LIMITS.command)
  const provider = llmConfigured() ? providerFromEnv() : null
  return Response.json(await runCommand(db, body.text, { provider, actor: actorOf(user) }))
})
