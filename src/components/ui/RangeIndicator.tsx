import { rangePercent, rangeScale, stockLevel } from './stockLevel'

type Size = 'sm' | 'md' | 'lg'

const TRACK_HEIGHT: Record<Size, string> = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' }
const TICK_HEIGHT: Record<Size, string> = { sm: 'h-3.5', md: 'h-4', lg: 'h-6' }

// strefa poniżej minimum: delikatne kreskowanie zamiast koloru — kolor pojawia się dopiero przy odchyleniu
const LOW_ZONE = 'repeating-linear-gradient(135deg, var(--color-band) 0 1px, transparent 1px 4px)'
const REMOVED = 'repeating-linear-gradient(135deg, var(--color-act) 0 1.5px, transparent 1.5px 4px)'

/**
 * Wskaźnik zakresu (analogowy wskaźnik z ekranu operatorskiego): stan na tle skali, kreska minimum
 * zawsze na 1/3 szerokości. Z `after` pokazuje skutek karty zmiany: przyrost na błękitno,
 * ubytek jako kreskowany odcinek, wskazówka na wartości „po”.
 */
export default function RangeIndicator({
  value,
  minimum,
  after = null,
  label,
  unit = '',
  size = 'md',
  className = '',
}: {
  value: number
  minimum: number
  after?: number | null
  /** nazwa pozycji do opisu dla czytnika ekranu */
  label: string
  unit?: string
  size?: Size
  className?: string
}) {
  const proposed = after !== null && after !== value
  const shown = proposed ? after : value
  const scale = rangeScale(minimum, proposed ? [value, after] : [value])
  const level = stockLevel(shown, minimum)
  const valuePct = rangePercent(value, scale)
  const afterPct = proposed ? rangePercent(after, scale) : valuePct
  const minPct = rangePercent(minimum, scale)
  const over = shown > scale
  const fill = level === 'empty' ? 'bg-alarm' : level === 'below' ? 'bg-warn' : 'bg-norm'
  const unitText = unit ? ` ${unit}` : ''
  const text = proposed
    ? `${label}: ${value}${unitText} → ${after}${unitText}, minimum ${minimum}`
    : `${label}: ${value}${unitText}, minimum ${minimum}`

  return (
    <div
      role="meter"
      aria-label={text}
      aria-valuemin={0}
      aria-valuemax={scale}
      aria-valuenow={Math.min(Math.max(shown, 0), scale)}
      aria-valuetext={text}
      className={`relative flex items-center ${TICK_HEIGHT[size]} ${className}`}
    >
      <div className={`relative w-full overflow-hidden rounded-full bg-track ${TRACK_HEIGHT[size]}`}>
        {minimum > 0 && <div className="absolute inset-y-0 left-0" style={{ width: `${minPct}%`, backgroundImage: LOW_ZONE }} />}
        {proposed && after < value ? (
          <>
            <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${afterPct}%` }} />
            <div className="absolute inset-y-0 opacity-80" style={{ left: `${afterPct}%`, width: `${valuePct - afterPct}%`, backgroundImage: REMOVED }} />
          </>
        ) : proposed ? (
          <>
            <div className="absolute inset-y-0 left-0 rounded-full bg-act" style={{ width: `${afterPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-l-full bg-norm" style={{ width: `${valuePct}%` }} />
          </>
        ) : (
          <div className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${fill}`} style={{ width: `${valuePct}%` }} />
        )}
        {over && <div className="absolute inset-y-0 right-0 w-1 bg-sheet/90" aria-hidden="true" />}
      </div>
      {minimum > 0 && (
        <span
          aria-hidden="true"
          className={`absolute top-0 w-0.5 -translate-x-1/2 rounded-full bg-ink ${TICK_HEIGHT[size]}`}
          style={{ left: `${minPct}%` }}
        />
      )}
      {proposed && (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 size-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-act"
          style={{ left: `${afterPct}%` }}
        />
      )}
    </div>
  )
}
