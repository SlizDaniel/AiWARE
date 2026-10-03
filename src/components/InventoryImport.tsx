import { useState } from 'react'
import {
  confirmInventoryImport,
  previewInventoryFile,
  type ImportField,
  type ImportPreview,
} from '@/lib/api'
import { Notice } from './ui/feedback'
import { CheckIcon, CloseIcon, UploadIcon } from './ui/icons'
import { buttonClass, fieldClass, panelClass } from './ui/styles'

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
    <section aria-labelledby="inventory-import-title" className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <div className="min-w-0">
          <h2 id="inventory-import-title" className="text-lg font-semibold text-ink">Import z Excela lub CSV</h2>
          <p className="mt-0.5 text-sm text-ink-2">Podgląd i mapowanie kolumn przed zapisaniem stanów.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="inventory-import-form"
          className={buttonClass(open ? 'ghost' : 'secondary')}
        >
          {open ? <CloseIcon size={16} /> : <UploadIcon size={16} />}
          {open ? 'Zamknij import' : 'Importuj plik'}
        </button>
      </div>

      {open && (
        <div id="inventory-import-form" className="space-y-6 border-t border-line px-5 py-5">
          <div className="space-y-3">
            <label
              className={
                // pole pliku (przezroczyste) przykrywa cały obszar: kliknięcie otwiera wybór, upuszczenie pliku trafia w nie natywnie
                'relative flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong px-6 py-7 text-center transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-act ' +
                (busy ? 'bg-ground/50 opacity-60' : 'bg-ground/50 hover:border-ink-2 hover:bg-ground')
              }
            >
              <UploadIcon size={24} className="mb-1 text-ink-2" />
              <span className="text-sm font-semibold text-ink">Wybierz plik magazynu</span>
              <span className="text-xs text-ink-2">lub upuść go tutaj · XLSX lub CSV · maksymalnie 4 MB</span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  void selectFile(file)
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
            </label>
            <p className="max-w-[70ch] text-sm text-ink-2">
              Przy aktywnym trybie LLM nagłówki i pierwsze 5 wierszy są wysyłane do Gemini, aby zaproponować mapowanie. W trybie offline plik jest mapowany lokalnie.
            </p>
          </div>

          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-ink-2">
              <span aria-hidden="true" className="size-2 animate-breathe rounded-full bg-act" />
              {preview ? 'Importuję…' : 'Przetwarzam plik…'}
            </p>
          )}
          {error && <Notice tone="alarm" role="alert">{error}</Notice>}
          {message && <Notice tone="ok" role="status">{message}</Notice>}

          {preview && mapping && (
            <>
              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-base font-semibold text-ink">Przypisz kolumny</h3>
                  <span className="text-sm text-ink-2">
                    <span className="tabular-nums">{preview.row_count}</span> wierszy danych · zapis dopiero po zatwierdzeniu
                  </span>
                </div>
                <p className="max-w-[70ch] text-sm text-ink-2">
                  {preview.mapping_source === 'llm'
                    ? 'Sugestia AI (Gemini) na podstawie nagłówków i pierwszych 5 wierszy. Procent to szacowana pewność modelu — sprawdź przypisania.'
                    : 'Dopasowanie po nazwach kolumn (bez AI). Procent to ocena reguł dopasowania — sprawdź przypisania.'}
                </p>
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <label key={field.id} className="block min-w-0">
                      <span className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-ink">
                          {field.label}
                          <span className="font-normal text-ink-2">{field.required ? ' · wymagane' : ' · opcjonalne'}</span>
                        </span>
                        {preview.mapping[field.id].column !== null && (
                          <span className="narrow shrink-0 text-xs tabular-nums text-mute">
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
                        className={`${fieldClass} h-10`}
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
                <Notice tone="warn">
                  <ul className="list-disc space-y-1 pl-4">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </Notice>
              )}

              {/* Podgląd na całą szerokość panelu (bez ramki w ramce); szerokie pliki przewijają się awaryjnie. */}
              <div className="relative -mx-5 overflow-x-auto border-y border-line">
                <table className="min-w-full text-left text-[13px]">
                  <caption className="sr-only">Podgląd pierwszych wierszy pliku</caption>
                  <thead className="bg-ground/60">
                    <tr>
                      {preview.headers.map((header) => (
                        <th key={header.index} scope="col" className="label-caps px-3 py-2.5 first:pl-5 last:pr-5" title={header.label}>
                          <div className="max-w-[12rem] truncate">{header.label}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{preview.preview.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-line">
                      {preview.headers.map((header) => (
                        <td
                          key={header.index}
                          className={'px-3 py-2.5 tabular-nums first:pl-5 last:pr-5 ' + (row[header.index] ? 'text-ink' : 'text-mute')}
                          title={row[header.index] || undefined}
                        >
                          <div className="max-w-[12rem] truncate">{row[header.index] || '—'}</div>
                        </td>
                      ))}
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-2">Pozycje o tej samej nazwie zostaną zaktualizowane zamiast powielone.</p>
                <button
                  type="button"
                  disabled={busy || mapping.name === null || mapping.quantity === null}
                  onClick={() => void confirm()}
                  className={buttonClass('action')}
                >
                  <CheckIcon size={18} />
                  {busy ? 'Importuję…' : 'Zatwierdź import'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
