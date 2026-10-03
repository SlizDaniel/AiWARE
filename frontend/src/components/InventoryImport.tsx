import { useState } from 'react'
import {
  confirmInventoryImport,
  previewInventoryFile,
  type ImportField,
  type ImportPreview,
} from '../api'

const FIELDS: { id: ImportField; label: string; required?: boolean }[] = [
  { id: 'name', label: 'Nazwa pozycji', required: true },
  { id: 'quantity', label: 'Aktualny stan', required: true },
  { id: 'minimum', label: 'Stan minimalny' },
  { id: 'location', label: 'Lokalizacja' },
  { id: 'unit', label: 'Jednostka' },
]

type Mapping = Record<ImportField, number | null>

export default function InventoryImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
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
    <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-bold">Import z Excela lub CSV</h2>
          <p className="mt-1 text-sm text-slate-500">Podgląd i mapowanie kolumn przed zapisaniem stanów.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-700"
        >
          {open ? 'Zamknij import' : 'Importuj plik'}
        </button>
      </div>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Wybierz plik magazynu</span>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                void selectFile(file)
              }}
              className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-sm text-slate-600 file:mr-4 file:cursor-pointer file:border-0 file:bg-slate-100 file:px-4 file:py-3 file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
            />
            <span className="mt-2 block text-xs text-slate-500">XLSX lub CSV · maksymalnie 5 MB</span>
          </label>

          {busy && <p className="text-sm font-medium text-indigo-700">Przetwarzam plik…</p>}
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</p>}
          {message && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</p>}

          {preview && mapping && (
            <>
              <div>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-bold">Przypisz kolumny</h3>
                  <span className="text-sm text-slate-500">{preview.row_count} wierszy danych · zapis dopiero po zatwierdzeniu</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <label key={field.id} className="block">
                      <span className="mb-1 block text-sm font-medium text-slate-700">
                        {field.label}{field.required ? ' · wymagane' : ' · opcjonalne'}
                        {preview.mapping[field.id].column !== null && (
                          <span className="ml-2 text-xs font-normal text-slate-400">
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
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
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
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <ul className="list-disc space-y-1 pl-5">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <tr>{preview.headers.map((header) => <th key={header.index} className="px-4 py-3">{header.label}</th>)}</tr>
                  </thead>
                  <tbody>{preview.preview.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-slate-100">
                      {preview.headers.map((header) => <td key={header.index} className="whitespace-nowrap px-4 py-3">{row[header.index] || '—'}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Pozycje o tej samej nazwie zostaną zaktualizowane zamiast powielone.</p>
                <button
                  type="button"
                  disabled={busy || mapping.name === null || mapping.quantity === null}
                  onClick={() => void confirm()}
                  className="rounded-lg bg-emerald-600 px-6 py-3 font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
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
