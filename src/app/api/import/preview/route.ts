import { randomUUID } from 'node:crypto'
import { suggestColumnMappingWithLlm } from '@/server/columnMapping'
import { savePendingImport } from '@/server/db'
import { HttpError, readBody, route } from '@/server/http'
import {
  FIELDS,
  ImportFileError,
  MAX_UPLOAD_BYTES,
  REQUIRED_FIELDS,
  readInventoryFile,
  suggestMapping,
} from '@/server/inventory'
import { session } from '@/server/session'
import { getAgentModeStatus, getAppSettings } from '@/server/settings'
import type { ColumnMapping } from '@/server/types'

export const maxDuration = 30

/** Rule-based mapping fills the fields the LLM left empty, never reusing a column. */
function mergeMappings(llm: ColumnMapping, rules: ColumnMapping): ColumnMapping {
  const merged = { ...llm }
  const used = new Set(FIELDS.map((field) => llm[field].column).filter((column) => column !== null))
  for (const field of FIELDS) {
    const fallback = rules[field].column
    if (merged[field].column === null && fallback !== null && !used.has(fallback)) {
      merged[field] = rules[field]
      used.add(fallback)
    }
  }
  return merged
}

/** Reads an uploaded CSV/XLSX and suggests a column mapping without writing inventory. */
export const POST = route(async (request: Request) => {
  const { db } = await session('kierownik')
  const filename = new URL(request.url).searchParams.get('filename') ?? ''
  const data = await readBody(request, MAX_UPLOAD_BYTES, 'Plik jest za duży (limit 4 MB).')
  let parsed: { headers: string[]; rows: string[][] }
  try {
    parsed = readInventoryFile(filename, data)
  } catch (error) {
    if (error instanceof ImportFileError) throw new HttpError(422, error.message)
    throw error
  }
  const { headers, rows } = parsed

  const rules = suggestMapping(headers)
  let mapping = rules
  let mappingSource: 'llm' | 'rules' = 'rules'
  // Respect the agent mode: offline/mock never sends file contents to the cloud.
  if ((await getAgentModeStatus(db)).effective_mode === 'llm') {
    const llm = await suggestColumnMappingWithLlm(headers, rows.slice(0, 5))
    if (llm) {
      mapping = mergeMappings(llm, rules)
      mappingSource = 'llm'
    }
  }

  const importId = randomUUID().replaceAll('-', '')
  await savePendingImport(db, importId, headers, rows)

  const missingRequired = REQUIRED_FIELDS.filter((field) => mapping[field].column === null)
  const warnings = missingRequired.map(
    (field) => `Nie znaleziono kolumny „${field}”. Wybierz ją ręcznie przed importem.`,
  )
  if (mapping.minimum.column === null) {
    const { default_minimum: defaultMinimum } = await getAppSettings(db)
    warnings.push(`Nie znaleziono minimum — nowe pozycje otrzymają ${defaultMinimum}, a istniejące zachowają obecny próg.`)
  }
  if (mapping.location.column === null) {
    warnings.push('Nie znaleziono lokalizacji — nowe pozycje pozostaną bez lokalizacji, a istniejące zachowają obecną.')
  }
  return Response.json({
    import_id: importId,
    headers: headers.map((header, index) => ({ index, label: header || `Kolumna ${index + 1}` })),
    preview: rows.slice(0, 5),
    row_count: rows.length,
    mapping,
    mapping_source: mappingSource,
    missing_required: missingRequired,
    warnings,
  })
})
