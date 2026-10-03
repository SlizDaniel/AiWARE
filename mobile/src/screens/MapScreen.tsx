import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { itemsForZone, zoneForItem } from '../../../src/components/zoneItems'
import { Card, Message, Title } from '../components/ui'
import type { Warehouse } from '../hooks/useWarehouse'

export type MapTarget = { name: string; location: string }

export function MapScreen({ data, target }: { data: Warehouse; target: MapTarget | null }) {
  const [selected, setSelected] = useState<number | null>(null)
  const highlighted = target ? zoneForItem(target, data.zones) : null
  const zone = data.zones.find(zone => zone.id === selected) ?? highlighted
  return <View>
    <Card><Title>Mapa magazynu</Title><Text className="text-stone-600">Schemat stref. Dotknij strefy, aby zobaczyć jej zawartość.</Text>
      {target ? <Message>{target.name}: {target.location || 'brak zapisanej lokalizacji'}{!highlighted ? ' · nie znaleziono odpowiadającej strefy' : ''}</Message> : null}
      <View className="flex-row flex-wrap justify-between gap-y-3">
        {data.zones.map(item => {
          const active = (selected ?? highlighted?.id) === item.id
          const items = itemsForZone(item, data.items, data.zones)
          return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }}
            onPress={() => setSelected(item.id)} className={`min-h-28 w-[48%] rounded-2xl border-2 p-4 ${active ? 'border-forest bg-accent' : 'border-stone-200 bg-paper'}`}>
            <Text className="text-lg font-bold text-ink">{item.name}</Text><Text className="mt-2 text-sm text-stone-600">{items.length} pozycji</Text>
            {items.some(item => item.quantity < item.minimum) ? <Text className="mt-1 text-xs font-semibold text-red-700">Niski zapas</Text> : null}
          </Pressable>
        })}
      </View>
      {!data.zones.length ? <Message>Dodaj strefę komendą „strefa: kartony”.</Message> : null}
    </Card>
    {zone ? <Card><Title>{zone.name}</Title>{itemsForZone(zone, data.items, data.zones).map(item =>
      <View key={item.id} className="flex-row justify-between gap-3"><Text className="flex-1 text-base text-ink">{item.name}</Text><Text className="font-semibold text-forest">{item.quantity} {item.unit}</Text></View>)}
      {!itemsForZone(zone, data.items, data.zones).length ? <Text className="text-stone-500">Brak pozycji przypisanych do tej strefy.</Text> : null}</Card> : null}
  </View>
}
