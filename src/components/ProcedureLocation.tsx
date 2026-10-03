import type { Item, Procedure, Zone } from '@/lib/api'
import { procedureZone } from './procedures'
import { PinIcon } from './ui/icons'
import { buttonClass } from './ui/styles'

type Props = {
  procedure: Pick<Procedure, 'topic' | 'text'>
  zones: Zone[]
  items: Item[]
  onShowZone: (id: number) => void
}

export default function ProcedureLocation({ procedure, zones, items, onShowZone }: Props) {
  const zone = procedureZone(procedure, zones, items)
  return zone ? (
    <button type="button" onClick={() => onShowZone(zone.id)} className={`${buttonClass('ghost', 'sm')} -ml-3 mt-2`}>
      <PinIcon size={16} />
      Pokaż na mapie: {zone.name}
    </button>
  ) : (
    <p className="mt-3 text-xs text-mute">Brak jednoznacznie powiązanej strefy na mapie.</p>
  )
}
