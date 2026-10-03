import { SECTIONS, type SectionId } from '../sections'

type Props = {
  current: SectionId
  onNavigate: (s: SectionId) => void
  connected: boolean
}

export default function Sidebar({ current, onNavigate, connected }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-slate-900 text-slate-100">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-xl">
          📦
        </div>
        <div>
          <div className="text-lg font-bold tracking-wide">MAGAZYNIER</div>
          <div className="text-xs text-slate-400">głosowy agent magazynowy</div>
        </div>
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onNavigate(s.id)}
            className={
              'w-full rounded-lg px-4 py-2.5 text-left text-[15px] font-medium transition-colors ' +
              (current === s.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white')
            }
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="px-5 py-4 text-xs text-slate-400">
        <span
          className={'mr-2 inline-block h-2.5 w-2.5 rounded-full ' + (connected ? 'bg-emerald-400' : 'bg-red-400')}
        />
        {connected ? 'Połączono z backendem' : 'Brak połączenia…'}
        <div className="mt-2 text-slate-500">HackYeah 2026 · tracer</div>
      </div>
    </aside>
  )
}
