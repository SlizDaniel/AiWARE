const formats = [
  { label: 'Eksportuj CSV', href: '/api/export/csv', filename: 'magazyn.csv' },
  { label: 'Eksportuj XLSX', href: '/api/export/xlsx', filename: 'magazyn.xlsx' },
]

export default function InventoryExport() {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Eksportuj stany magazynowe">
      {formats.map((format) => (
        <a
          key={format.href}
          href={format.href}
          download={format.filename}
          className="border border-[#c9c7bf] bg-white px-3 py-2 text-sm font-semibold text-[#454b46] transition-colors hover:bg-[#f0efe9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
        >
          {format.label}
        </a>
      ))}
    </div>
  )
}
