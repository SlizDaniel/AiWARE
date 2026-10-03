import { DownloadIcon } from './ui/icons'
import { buttonClass } from './ui/styles'

const formats = [
  { label: 'Eksportuj CSV', short: 'CSV', href: '/api/export/csv', filename: 'magazyn.csv' },
  { label: 'Eksportuj XLSX', short: 'XLSX', href: '/api/export/xlsx', filename: 'magazyn.xlsx' },
]

export default function InventoryExport() {
  return (
    <div role="group" className="flex flex-wrap items-center gap-2" aria-label="Eksportuj stany magazynowe">
      {formats.map((format) => (
        <a
          key={format.href}
          href={format.href}
          download={format.filename}
          aria-label={format.label}
          title={format.label}
          className={buttonClass('secondary', 'sm')}
        >
          <DownloadIcon size={16} />
          {format.short}
        </a>
      ))}
    </div>
  )
}
