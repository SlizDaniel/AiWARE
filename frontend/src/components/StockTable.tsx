import type { Item } from '../api'

export default function StockTable({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <Empty text="Brak pozycji — stany wypełnią się po imporcie Excela (karta 05)." />
  }
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
            <th className="px-6 py-4">Pozycja</th>
            <th className="px-6 py-4 text-right">Stan</th>
            <th className="px-6 py-4 text-right">Minimum</th>
            <th className="px-6 py-4">Jednostka</th>
            <th className="px-6 py-4">Lokalizacja</th>
            <th className="px-6 py-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const low = it.quantity <= it.minimum
            return (
              <tr key={it.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-6 py-4 font-semibold">{it.name}</td>
                <td className="px-6 py-4 text-right text-lg font-bold tabular-nums">{it.quantity}</td>
                <td className="px-6 py-4 text-right tabular-nums text-slate-500">{it.minimum}</td>
                <td className="px-6 py-4 text-slate-500">{it.unit}</td>
                <td className="px-6 py-4 font-mono text-sm text-slate-500">{it.location || '—'}</td>
                <td className="px-6 py-4">
                  <span
                    className={
                      'rounded-full px-3 py-1 text-xs font-bold ' +
                      (low ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')
                    }
                  >
                    {low ? 'Poniżej minimum' : 'OK'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white/60 p-12 text-center text-slate-500">
      {text}
    </div>
  )
}
