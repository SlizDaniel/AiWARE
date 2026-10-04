import { authMode, commandAiModel, geminiSttModel, isDemoMode } from '@/server/env'
import { route } from '@/server/http'
import { getDb, storageKind } from '@/server/runtime'
import { getAgentModeStatus } from '@/server/settings'

// Public: no data, only configuration status (used by the UI banner and uptime checks).
export const GET = route(async () => {
  const db = await getDb()
  const status = await getAgentModeStatus(db)
  return Response.json({
    status: 'ok',
    mode: status.effective_mode,
    demo_mode: isDemoMode(),
    storage: storageKind(),
    auth_mode: authMode(),
    llm_model: commandAiModel(),
    stt_model: process.env.STT_API_KEY?.trim() ? process.env.STT_MODEL?.trim() || 'whisper-large-v3' : geminiSttModel(),
  })
})
