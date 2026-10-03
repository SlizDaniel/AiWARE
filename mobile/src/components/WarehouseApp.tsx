import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { Button, Loading, Message } from './ui'
import type { Api } from '../lib/client'
import { useWarehouse } from '../hooks/useWarehouse'
import { CommandScreen } from '../screens/CommandScreen'
import { InventoryScreen } from '../screens/InventoryScreen'
import { MapScreen, type MapTarget } from '../screens/MapScreen'
import { RecordsScreen } from '../screens/RecordsScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { supabase } from '../lib/supabase'

const TABS = { command: 'Magu', inventory: 'Stany', map: 'Mapa', history: 'Historia', more: 'Więcej' }
type Tab = keyof typeof TABS
type More = 'orders' | 'procedures' | 'settings'

export function WarehouseApp({ api }: { api: Api }) {
  const { data, error, refreshing, reload } = useWarehouse(api)
  const [tab, setTab] = useState<Tab>('command')
  const [more, setMore] = useState<More>('orders')
  const [target, setTarget] = useState<MapTarget | null>(null)

  return <View className="flex-1 bg-paper">
    <View className="flex-row items-center justify-between border-b border-stone-200 px-5 py-4">
      <View><Text className="text-xs font-bold uppercase tracking-widest text-forest">MAGAZYNIER</Text><Text className="text-lg font-bold text-ink">{data?.user.display_name ?? 'Twój magazyn'}</Text></View>
      <View className="rounded-full bg-accent px-3 py-2"><Text className="text-xs font-semibold text-forest">{data?.user.role === 'kierownik' ? 'Kierownik' : 'Pracownik'}</Text></View>
    </View>
    <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor="#315b45" />}>
      <View className="gap-3 p-4 pb-8">
        {error ? <View className="gap-2"><Message error>{error}</Message><Button title="Spróbuj ponownie" secondary onPress={() => void reload()} disabled={refreshing} />
          {!data ? <Button title="Wróć do logowania" secondary onPress={() => void supabase!.auth.signOut({ scope: 'local' })} /> : null}</View> : null}
        {!data && !error ? <Loading /> : null}
        {data?.health.storage === 'ephemeral' ? <Message error>Serwer używa nietrwałej bazy. Dane mogą zniknąć po restarcie — skonfiguruj Supabase.</Message> : null}
        {data ? <>
          {/* Keep the command card mounted while switching sections so a pending proposal is retained. */}
          <View style={{ display: tab === 'command' ? 'flex' : 'none' }}>
            <CommandScreen active={tab === 'command'} api={api} data={data} reload={reload} onLocation={(name, location) => { setTarget({ name, location }); setTab('map') }} />
          </View>
          {tab === 'inventory' ? <InventoryScreen api={api} data={data} reload={reload} /> : null}
          {tab === 'map' ? <MapScreen key={`${target?.name ?? ''}:${target?.location ?? ''}`} data={data} target={target} /> : null}
          {tab === 'history' ? <RecordsScreen key="history" kind="history" data={data} api={api} reload={reload} /> : null}
          {tab === 'more' ? <>
            <View className="flex-row gap-2">{(['orders', 'procedures', 'settings'] as const).map(kind => <View key={kind} className="flex-1"><Button
              title={kind === 'orders' ? 'Kolejka' : kind === 'procedures' ? 'Procedury' : 'Konto'} secondary={more !== kind} onPress={() => setMore(kind)} /></View>)}</View>
            {more === 'settings' ? <SettingsScreen data={data} api={api} reload={reload} /> : <RecordsScreen key={more} kind={more} data={data} api={api} reload={reload} />}
          </> : null}
        </> : null}
      </View>
    </ScrollView>
    <View className="flex-row border-t border-stone-200 bg-white px-1 py-2">
      {(Object.entries(TABS) as [Tab, string][]).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
        onPress={() => setTab(key)} className={`min-h-14 flex-1 items-center justify-center rounded-2xl ${tab === key ? 'bg-accent' : ''}`}>
        <Text className={`text-sm font-semibold ${tab === key ? 'text-forest' : 'text-stone-500'}`}>{label}</Text></Pressable>)}
    </View>
  </View>
}
