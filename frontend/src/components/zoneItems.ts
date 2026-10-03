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

export function itemsForZone(zone: Zone, items: Item[]): Item[] {
  const name = normalize(zone.name)
  return items.filter((item) => {
    const location = normalize(item.location)
    return normalize(item.name) === name || location === name || location.startsWith(`${name} `)
  })
}
