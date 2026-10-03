import { listItems, listProcedures, listZones } from '@/server/db'
import { isDemoMode } from '@/server/env'
import { HttpError, readBody, route } from '@/server/http'
import { MAX_UPLOAD_BYTES } from '@/server/inventory'
import { session } from '@/server/session'
import { getAppSettings, TEXT_ONLY_STT_DETAIL } from '@/server/settings'
import { STTUnavailable, sttVocabulary, transcribe } from '@/server/stt'

export const maxDuration = 30

/**
 * Card 04: audio (MediaRecorder) → transcription. A failure or missing
 * configuration is an explicit 503 — the UI then highlights the text field.
 */
export const POST = route(async (request: Request) => {
  const { db } = await session()
  if (isDemoMode()) throw new HttpError(503, 'Demo offline — STT wyłączone; wpisz komendę w polu tekstowym.')
  const settings = await getAppSettings(db)
  if (settings.voice_mode === 'text') throw new HttpError(503, TEXT_ONLY_STT_DETAIL)
  const data = await readBody(request, MAX_UPLOAD_BYTES, 'Nagranie jest za duże (limit 4 MB).')
  if (data.byteLength === 0) throw new HttpError(422, 'Brak nagrania audio.')
  const mimeType = request.headers.get('content-type') || 'audio/webm'
  try {
    // Names from this warehouse make the recogniser spell items, zones and the prefix correctly.
    const items = await listItems(db)
    const zones = await listZones(db)
    const procedures = await listProcedures(db)
    const vocabulary = sttVocabulary({
      prefix: settings.prefix,
      items: items.map((item) => item.name),
      zones: zones.map((zone) => zone.name),
      topics: procedures.map((procedure) => procedure.topic),
    })
    return Response.json({ text: await transcribe(data, mimeType, { vocabulary }) })
  } catch (error) {
    if (error instanceof STTUnavailable) throw new HttpError(503, error.message)
    throw error
  }
})
