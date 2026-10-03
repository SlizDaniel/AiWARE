import type { Item, Zone } from '../api'

export function normalizeZoneName(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^strefa\s*/, '')
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, ' ')
    .trim()
}

export function itemsForZone(zone: Zone, items: Item[], allZones: Zone[]): Item[] {
  const knownZones = allZones
    .map((candidate) => ({ id: candidate.id, name: normalizeZoneName(candidate.name) }))
    .sort((a, b) => a.id - b.id)
  return items.filter((item) => {
    const location = normalizeZoneName(item.location)
    const locationMatch = knownZones
      .filter((candidate) => candidate.name && (location === candidate.name || location.startsWith(`${candidate.name} `)))
      .sort((a, b) => b.name.length - a.name.length || a.id - b.id)[0]
    if (locationMatch) return locationMatch.id === zone.id

    return knownZones.find((candidate) => candidate.name === normalizeZoneName(item.name))?.id === zone.id
  })
}
