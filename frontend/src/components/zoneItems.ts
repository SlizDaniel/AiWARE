import type { Item, Zone } from '../api'

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^strefa\s*/, '')
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, ' ')
    .trim()
}

export function itemsForZone(zone: Zone, items: Item[], allZones: Zone[]): Item[] {
  const knownZones = allZones.map((candidate) => ({ id: candidate.id, name: normalize(candidate.name) }))
  return items.filter((item) => {
    const location = normalize(item.location)
    const locationMatch = knownZones
      .filter((candidate) => candidate.name && (location === candidate.name || location.startsWith(`${candidate.name} `)))
      .sort((a, b) => b.name.length - a.name.length)[0]
    if (locationMatch) return locationMatch.id === zone.id

    return knownZones.find((candidate) => candidate.name === normalize(item.name))?.id === zone.id
  })
}
