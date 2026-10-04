import { useState } from 'react'
import { readApiJson } from '@/lib/api'
import type { TaskHelp } from '@/lib/taskHelp'
import { secondaryButton } from './dashboard/ui'
export default function TaskHelpPanel({id}:{id:string}) {
  const [help,setHelp] = useState<TaskHelp | null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const load = async () => {
    if (busy) return
    setBusy(true);setError('');setHelp(null)
    try { setHelp(await readApiJson<TaskHelp>(await fetch(`/api/tasks/${encodeURIComponent(id)}/help`,{method:'POST',cache:'no-store'}))) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać pomocy.') }
    finally { setBusy(false) }
  }
  return <div className="mt-4 border-t border-line pt-3">
    <button className={secondaryButton} disabled={busy} onClick={() => void load()}>{busy ? 'Analizuję procedury…' : 'Jak wykonać? — procedury i AI'}</button>
    <p className="mt-2 text-xs text-ink-2">W trybie AI treść zadania i pasujące procedury trafiają do Gemini po kliknięciu.</p>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {help && <section aria-label="Pomoc do zadania" className="mt-3 space-y-3">
      <h3 className="font-semibold">{help.mode === 'llm' ? 'Kroki wybrane przez AI' : help.mode === 'missing' ? 'Brak instrukcji do zadania' : 'Procedury do sprawdzenia (bez AI)'}</h3>
      <p role="status" className="text-sm">{help.warning}</p>
      <ol className="list-decimal space-y-2 pl-5">{help.steps.map((step,index) => <li key={index}><p className="whitespace-pre-wrap">{step.text}</p><p className="text-xs text-ink-2">Źródło: {step.procedure_topic} (#{step.procedure_id})</p></li>)}</ol>
      {help.sources.map(source => <details key={source.id} className="rounded border border-line p-3"><summary>Pełna procedura: {source.topic} (#{source.id})</summary><p className="mt-2 whitespace-pre-wrap text-sm">{source.text}</p></details>)}
    </section>}
  </div>
}
