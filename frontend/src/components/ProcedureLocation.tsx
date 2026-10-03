import type { Item, Procedure, Zone } from '../api'
import { procedureZone } from './procedures'

type Props = {
  procedure: Pick<Procedure, 'topic' | 'text'>
  zones: Zone[]
  items: Item[]
  onShowZone: (id: number) => void
}

export default function ProcedureLocation({ procedure, zones, items, onShowZone }: Props) {
  const zone = procedureZone(procedure, zones, items)
  return zone ? (
    <button type="button" onClick={() => onShowZone(zone.id)} className="mt-3 border border-[#cbd8c9] bg-white px-3 py-2 text-sm font-semibold text-[#315b37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]">Pokaż na mapie: {zone.name}</button>
  ) : (
    <p className="mt-3 text-xs text-[#70756f]">Brak jednoznacznie powiązanej strefy na mapie.</p>
  )
}
