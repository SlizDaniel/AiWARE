export default function Placeholder({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center border border-dashed border-[#d8d6cf] bg-[#fbfaf7] p-8 text-center sm:min-h-[420px] sm:p-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#646b64]">Kolejna karta projektu</p>
      <h3 className="mt-3 text-xl font-bold text-[#454b46]">{label}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#70756f]">
        {note ?? 'Sekcja powstanie w kolejnych kartach tracer bullet — w tej iteracji jest celowo pusta.'}
      </p>
    </div>
  )
}
