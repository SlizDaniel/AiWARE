export default function Placeholder({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white/60 p-12 text-center">
      <div className="text-5xl">{label === 'Mapa' ? '🗺️' : label === 'Kolejka zatwierdzeń' ? '📥' : label === 'Procedury' ? '📋' : '⚙️'}</div>
      <h3 className="mt-4 text-xl font-bold text-slate-700">{label}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        {note ?? 'Sekcja powstanie w kolejnych kartach tracer bullet — w tej iteracji jest celowo pusta.'}
      </p>
    </div>
  )
}
