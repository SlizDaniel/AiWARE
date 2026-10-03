import { useState } from 'react'
import {
  confirmInventoryImport,
  previewInventoryFile,
  type ImportField,
  type ImportPreview,
} from '@/lib/api'

const FIELDS: { id: ImportField; label: string; required?: boolean }[] = [
  { id: 'name', label: 'Nazwa pozycji', required: true },
  { id: 'quantity', label: 'Aktualny stan', required: true },
  { id: 'minimum', label: 'Stan minimalny' },
  { id: 'location', label: 'Lokalizacja' },
  { id: 'unit', label: 'Jednostka' },
]

type Mapping = Record<ImportField, number | null>

export default function InventoryImport({ onImported, initialOpen = false }: { onImported: () => void; initialOpen?: boolean }) {
  // Ustawienia (źródło danych = import pliku / „Przejdź do importu”) otwierają panel, dopóki użytkownik sam go nie zamknie.
  const [openOverride, setOpen] = useState<boolean | null>(null)
  const open = openOverride ?? initialOpen
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const selectFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setError(null)
    setMessage(null)
    setPreview(null)
    setMapping(null)
    try {
      const result = await previewInventoryFile(file)
      setPreview(result)
      setMapping({
        name: result.mapping.name.column,
        quantity: result.mapping.quantity.column,
        minimum: result.mapping.minimum.column,
        location: result.mapping.location.column,
        unit: result.mapping.unit.column,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać pliku.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!preview || !mapping || mapping.name === null || mapping.quantity === null || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await confirmInventoryImport(preview.import_id, mapping)
      setMessage(`Import gotowy: ${result.inserted} nowych pozycji, ${result.updated} zaktualizowanych.`)
      setPreview(null)
      setMapping(null)
      onImported()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import się nie powiódł.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border border-[#e8e5de] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-bold">Import z Excela lub CSV</h2>
          <p className="mt-1 text-sm text-[#646b64]">Podgląd i mapowanie kolumn przed zapisaniem stanów.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="inventory-import-form"
          className="bg-[#292d2b] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#454b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
        >
          {open ? 'Zamknij import' : 'Importuj plik'}
        </button>
      </div>

      {open && (
        <div id="inventory-import-form" className="space-y-5 border-t border-[#e8e5de] px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#454b46]">Wybierz plik magazynu</span>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                void selectFile(file)
              }}
              className="block w-full cursor-pointer border border-[#d8d6cf] bg-white text-sm text-[#646b64] file:mr-4 file:cursor-pointer file:border-0 file:bg-[#f5f4f0] file:px-4 file:py-3 file:font-semibold file:text-[#454b46] hover:file:bg-[#e8e5de] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
            />
            <span className="mt-2 block text-xs text-[#70756f]">XLSX lub CSV · maksymalnie 4 MB</span>
          </label>
          <p className="text-sm text-[#646b64]">
            Przy aktywnym trybie LLM nagłówki i pierwsze 5 wierszy są wysyłane do Gemini, aby zaproponować mapowanie. W trybie offline plik jest mapowany lokalnie.
          </p>

          {busy && <p role="status" className="text-sm font-medium text-[#315b37]">Przetwarzam plik…</p>}
          {error && <p role="alert" className="border border-[#edc8c5] bg-[#fff7f6] px-4 py-3 text-sm font-medium text-[#8f3936]">{error}</p>}
          {message && <p role="status" className="border border-[#cbd8c9] bg-[#f6f8f4] px-4 py-3 text-sm font-medium text-[#315b37]">{message}</p>}

          {preview && mapping && (
            <>
              <div>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-bold">Przypisz kolumny</h3>
                  <span className="text-sm text-[#646b64]">{preview.row_count} wierszy danych · zapis dopiero po zatwierdzeniu</span>
                </div>
                <p className="mb-3 text-sm text-[#646b64]">
                  {preview.mapping_source === 'llm'
                    ? 'Sugestia AI (Gemini) na podstawie nagłówków i pierwszych 5 wierszy. Procent to szacowana pewność modelu — sprawdź przypisania.'
                    : 'Dopasowanie po nazwach kolumn (bez AI). Procent to ocena reguł dopasowania — sprawdź przypisania.'}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <label key={field.id} className="block">
                      <span className="mb-1 block text-sm font-medium text-[#454b46]">
                        {field.label}{field.required ? ' · wymagane' : ' · opcjonalne'}
                        {preview.mapping[field.id].column !== null && (
                          <span className="ml-2 text-xs font-normal text-[#70756f]">
                            sugestia {Math.round(preview.mapping[field.id].confidence * 100)}%
                          </span>
                        )}
                      </span>
                      <select
                        value={mapping[field.id] === null ? '' : String(mapping[field.id])}
                        onChange={(event) => setMapping((current) => current && ({
                          ...current,
                          [field.id]: event.target.value === '' ? null : Number(event.target.value),
                        }))}
                        className="w-full border border-[#d8d6cf] bg-white px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
                      >
                        <option value="">Nie mapuj tej kolumny</option>
                        {preview.headers.map((header) => (
                          <option key={header.index} value={header.index}>{header.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              {preview.warnings.length > 0 && (
                <div className="border border-[#ead9a9] bg-[#fffaf0] px-4 py-3 text-sm text-[#805c12]">
                  <ul className="list-disc space-y-1 pl-5">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              )}

              <div className="overflow-x-auto border border-[#e8e5de]">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[#f5f4f0] text-xs font-bold uppercase tracking-wide text-[#646b64]">
                    <tr>{preview.headers.map((header) => <th key={header.index} className="px-4 py-3">{header.label}</th>)}</tr>
                  </thead>
                  <tbody>{preview.preview.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-[#e8e5de]">
                      {preview.headers.map((header) => <td key={header.index} className="whitespace-nowrap px-4 py-3">{row[header.index] || '—'}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#646b64]">Pozycje o tej samej nazwie zostaną zaktualizowane zamiast powielone.</p>
                <button
                  type="button"
                  disabled={busy || mapping.name === null || mapping.quantity === null}
                  onClick={() => void confirm()}
                  className="bg-[#315b37] px-6 py-3 font-bold text-white transition-colors hover:bg-[#274a2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Zatwierdź import
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
