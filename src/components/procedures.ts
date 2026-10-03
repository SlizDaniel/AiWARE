import type { Item, Procedure, Zone } from '@/lib/api'
import { itemsForZone, normalizeZoneName } from './zoneItems'

export function filterProcedures(procedures: Procedure[], query: string): Procedure[] {
  const fragment = query.trim().toLocaleLowerCase('pl-PL')
  return procedures.filter((procedure) =>
    `${procedure.topic}\n${procedure.text}`.toLocaleLowerCase('pl-PL').includes(fragment),
  )
}

export function procedureZone(procedure: Pick<Procedure, 'topic' | 'text'>, zones: Zone[], items: Item[]): Zone | null {
  const locations = [...procedure.text.matchAll(/\bstref(?:a|ie|y|ę)\s*:?\s+([^,.;\n]+)/giu)]
  if (locations.length > 0) {
    const matched = locations.map((location) => {
      const name = normalizeZoneName(location[1])
      return [...zones]
        .filter((zone) => {
          const candidate = normalizeZoneName(zone.name)
          return candidate && (name === candidate || name.startsWith(`${candidate} `))
        })
        .sort((a, b) => normalizeZoneName(b.name).length - normalizeZoneName(a.name).length || a.id - b.id)[0]
    })
    // An explicit unknown or conflicting location must not point to another zone.
    if (matched.some((zone) => !zone)) return null
    return matched.every((zone) => zone.id === matched[0].id) ? matched[0] : null
  }

  const topic = normalizeZoneName(procedure.topic)
  const matches = zones.filter((zone) =>
    normalizeZoneName(zone.name) === topic ||
    itemsForZone(zone, items, zones).some((item) => normalizeZoneName(item.name) === topic),
  )
  return matches.length === 1 ? matches[0] : null
}
