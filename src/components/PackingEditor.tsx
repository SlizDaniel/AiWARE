import { useEffect, useState } from 'react'
import { confirmProposal, fetchPackaging, linkPackaging, proposePackingRule, type Item, type Packaging, type Procedure, type Proposal } from '@/lib/api'
import { buttonClass, fieldClass } from './ui/styles'

type Props = { items: Item[]; procedures: Procedure[]; onChanged: () => void }

export default function PackingEditor({ items, procedures, onChanged }: Props) {
  const [catalogue, setCatalogue] = useState<Packaging[]>([])
  const [catalogueLoading, setCatalogueLoading] = useState(true)
  const [catalogueError, setCatalogueError] = useState('')
  const [reload, setReload] = useState(0)
  const [itemId, setItemId] = useState('')
  const [editingVersion, setEditingVersion] = useState(0)
  const [packagingId, setPackagingId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setCatalogueLoading(true)
    fetchPackaging().then((data) => { if (!cancelled) { setCatalogue(data); setCatalogueError('') } })
      .catch((reason) => { if (!cancelled) setCatalogueError(reason instanceof Error ? reason.message : 'Nie udało się pobrać katalogu.') })
      .finally(() => { if (!cancelled) setCatalogueLoading(false) })
    return () => { cancelled = true }
  }, [reload])

  function chooseProduct(id: string) {
    setItemId(id)
    const rule = procedures.find((p) => p.item_id === Number(id))
    setEditingVersion(rule?.version ?? 0)
    setPackagingId(rule?.packaging_id ? String(rule.packaging_id) : '')
    setQuantity(String(rule?.quantity_per_package ?? 1))
    setNotes(rule?.notes ?? '')
    setError('')
    setNotice('')
  }

  async function prepare(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { setPreview(await proposePackingRule({ item_id: Number(itemId), packaging_id: Number(packagingId), quantity_per_package: Number(quantity), notes, expected_version: editingVersion })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się przygotować reguły.') }
    finally { setBusy(false) }
  }

  async function confirm() {
    if (!preview || busy) return
    setBusy(true); setError('')
    try { await confirmProposal(preview.id); setEditingVersion(editingVersion + 1); setPreview(null); setNotice('Reguła została zatwierdzona.'); onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać reguły.'); setPreview(null) }
    finally { setBusy(false) }
  }

  async function changeLink(id: number, value: string) {
    setBusy(true); setError(''); setNotice('')
    try { setCatalogue(await linkPackaging(id, value ? Number(value) : null)); onChanged(); setNotice('Powiązanie opakowania zapisane.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać powiązania.') }
    finally { setBusy(false) }
  }

  const existing = procedures.find((p) => p.item_id === Number(itemId))
  return <div className="border-t border-line px-5 py-5">
    <h2 className="text-lg font-semibold text-ink">{existing ? 'Edytuj regułę pakowania' : 'Nowa reguła pakowania'}</h2>
    <p className="mt-1 text-sm text-ink-2">Jedna zatwierdzona reguła na produkt. Wybierz opakowanie i podaj ilość produktu na jedno opakowanie.</p>
    {itemId && !preview && <button type="button" disabled={busy} className={`${buttonClass('ghost', 'sm')} mt-2`} onClick={() => chooseProduct(itemId)}>Wczytaj bieżącą regułę</button>}
    {catalogueLoading && <p className="mt-3 text-sm text-mute" role="status">Pobieram katalog opakowań…</p>}
    {catalogueError && <div className="mt-3 text-sm" role="alert">{catalogueError} <button className={buttonClass('secondary', 'sm')} onClick={() => setReload((r) => r + 1)}>Ponów pobieranie katalogu</button></div>}
    <form className="mt-4 space-y-4" onSubmit={prepare}>
      <fieldset disabled={busy || !!preview || catalogueLoading || !!catalogueError} className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm text-ink">Produkt<select required className={`${fieldClass} mt-1`} value={itemId} onChange={(e) => chooseProduct(e.target.value)}>
          <option value="">Wybierz produkt</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="text-sm text-ink">Opakowanie<select required className={`${fieldClass} mt-1`} value={packagingId} onChange={(e) => setPackagingId(e.target.value)}>
          <option value="">Wybierz opakowanie</option>{catalogue.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <label className="text-sm text-ink">Ilość na opakowanie ({items.find((i) => i.id === Number(itemId))?.unit ?? 'jednostki produktu'})<input required type="number" min="1" max="1000000" step="1" className={`${fieldClass} mt-1`} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        <label className="text-sm text-ink sm:col-span-3">Dodatkowe uwagi (opcjonalnie)<textarea maxLength={500} rows={2} className={`${fieldClass} mt-1`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Np. dodaj przekładki i oznacz jako delikatne" /></label>
      </fieldset>
      {!preview && <button type="submit" disabled={busy || catalogueLoading || !!catalogueError || items.length === 0} className={buttonClass('primary', 'sm')}>{busy ? 'Przygotowuję…' : 'Podgląd reguły'}</button>}
    </form>
    {preview && <div className="mt-4 rounded-lg border border-line bg-ground p-4" aria-label="Potwierdzenie reguły">
      <h3 className="font-semibold text-ink">Sprawdź i zatwierdź regułę</h3><p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{preview.summary}</p>
      <div className="mt-3 flex gap-2"><button onClick={() => void confirm()} disabled={busy} className={buttonClass('primary', 'sm')}>{busy ? 'Zapisuję…' : 'Zatwierdź regułę'}</button>
        <button onClick={() => setPreview(null)} disabled={busy} className={buttonClass('secondary', 'sm')}>Wróć do edycji</button></div>
    </div>}
    {error && <p className="mt-3 text-sm text-alarm-ink" role="alert">{error}</p>}
    {notice && <p className="mt-3 text-sm text-ink" role="status">{notice}</p>}
    <details className="mt-5 border-t border-line pt-4">
      <summary className="cursor-pointer font-medium text-ink">Katalog opakowań — powiązania ze stanami</summary>
      <p className="mt-2 text-sm text-ink-2">Wskaż pozycję magazynową dla każdego opakowania, aby pracownik widział jego dostępny stan. Reguła opisuje sposób pakowania; nie zmienia stanów magazynowych.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{catalogue.map((p) => <label key={p.id} className="text-sm text-ink">{p.name}<select aria-label={`Stan magazynowy: ${p.name}`} disabled={busy || !!preview || catalogueLoading || !!catalogueError} className={`${fieldClass} mt-1`} value={p.inventory_item_id ?? ''} onChange={(e) => void changeLink(p.id, e.target.value)}>
        <option value="">Brak powiązania</option>{items.map((i) => <option value={i.id} key={i.id}>{i.name}</option>)}
      </select></label>)}</div>
    </details>
  </div>
}
