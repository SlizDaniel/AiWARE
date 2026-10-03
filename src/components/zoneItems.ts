import type { Item, Zone } from '@/lib/api'

export type MapTarget = Pick<Item, 'name' | 'location'>

export function mapTargetFromAnswer(tool: string, data: Record<string, unknown>): MapTarget | null {
  const item = tool === 'get_location' ? data : tool === 'get_stock' ? data.item : null
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const name = tool === 'get_location' ? record.item_name : record.name
  if (typeof name !== 'string' || !name.trim() || typeof record.location !== 'string') return null
  return { name, location: record.location }
}

export function normalizeZoneName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pl-PL')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^strefa\b[\s:]*/, '')
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, ' ')
    .trim()
}

export function findZoneByName(name: string, zones: Zone[]): Zone | null {
  const normalized = normalizeZoneName(name)
  if (!normalized) return null
  return [...zones].sort((a, b) => a.id - b.id)
    .find((zone) => normalizeZoneName(zone.name) === normalized) ?? null
}

export function zoneForItem(item: MapTarget, allZones: Zone[]): Zone | null {
  const location = normalizeZoneName(item.location)
  const ordered = [...allZones].sort((a, b) => a.id - b.id)
  const locationMatch = ordered
    .filter((zone) => {
      const name = normalizeZoneName(zone.name)
      return name && (location === name || location.startsWith(`${name} `))
    })
    .sort((a, b) => normalizeZoneName(b.name).length - normalizeZoneName(a.name).length || a.id - b.id)[0]
  return locationMatch ?? findZoneByName(item.name, ordered)
}

export function itemsForZone(zone: Zone, items: Item[], allZones: Zone[]): Item[] {
  return items.filter((item) => zoneForItem(item, allZones)?.id === zone.id)
}
