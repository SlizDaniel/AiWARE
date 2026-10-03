import { useState } from 'react'
import { Text, View } from 'react-native'
import { isUndoable } from '../../../src/components/history'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { Warehouse } from '../hooks/useWarehouse'

export function RecordsScreen({ kind, data, api, reload }: {
  kind: 'history' | 'orders' | 'procedures'; data: Warehouse; api: Api; reload: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ title: string; message: string; action: () => Promise<unknown> } | null>(null)
  const manager = data.user.role === 'kierownik'

  async function mutate(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); setPending(null); await reload() }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać zmiany.') }
    finally { setBusy(false) }
  }

  const confirmation = (title: string, message: string, action: () => Promise<unknown>) =>
    setPending({ title, message, action })

  return <View>
    {error ? <Message error>{error}</Message> : null}
    {pending ? <Card><Title>{pending.title}</Title><Text className="text-ink">{pending.message}</Text>
      <Button title="Potwierdź" disabled={busy} onPress={() => void mutate(pending.action)} />
      <Button title="Anuluj" secondary disabled={busy} onPress={() => setPending(null)} /></Card> : null}
    {kind === 'history' ? <>
      <Card><Title>Historia zmian</Title><Text className="text-stone-600">Kto, kiedy i co zmienił. Cofnięcie również pozostawia ślad w audycie.</Text></Card>
      {data.history.map(entry => <Card key={entry.id}>
        <Text className="text-xs text-stone-500">{entry.ts} · {entry.actor}</Text>
        <Text className="text-base font-semibold text-ink">{entry.text}</Text>
        {entry.event_type === 'stock_change' ? <Text className="text-lg font-bold text-forest">{entry.item_name}: {entry.before} → {entry.after}</Text> : null}
        {entry.undone_by ? <Text className="text-sm text-stone-500">Cofnięto tę zmianę.</Text> : null}
        {manager && isUndoable(entry) ?
          <Button title="Cofnij zmianę" secondary disabled={busy} onPress={() => confirmation('Cofnąć zmianę?', entry.text, () => api.undo(entry.id))} /> : null}
      </Card>)}
      {!data.history.length ? <Message>Historia jest pusta.</Message> : null}
    </> : null}
    {kind === 'orders' ? <>
      <Card><Title>Kolejka zamówień</Title><Text className="text-stone-600">Szkice uzupełnienia zapasu. Decyzję podejmuje kierownik.</Text></Card>
      {data.orders.map(order => <Card key={order.id}><Title>{order.item_name}</Title><Text className="text-2xl font-bold text-forest">{order.quantity} {order.unit}</Text>
        <Text className="text-stone-600">Dostawa: {order.deliver_on} · {order.status === 'pending' ? 'oczekuje' : order.status === 'approved' ? 'zatwierdzono' : 'odrzucono'}</Text>
        {manager && order.status === 'pending' ? <View className="gap-2">
          <Button title="Zatwierdź szkic" disabled={busy} onPress={() => confirmation('Zatwierdzić szkic?', `${order.item_name}: ${order.quantity} ${order.unit}`, () => api.decideOrder(order.id, true))} />
          <Button title="Odrzuć szkic" secondary disabled={busy} onPress={() => confirmation('Odrzucić szkic?', order.item_name, () => api.decideOrder(order.id, false))} />
        </View> : null}</Card>)}
      {!data.orders.length ? <Message>Nie ma szkiców zamówień.</Message> : null}
    </> : null}
    {kind === 'procedures' ? <>
      <Card><Title>Procedury</Title><Field label="Szukaj procedury" value={query} onChangeText={setQuery} /><Text className="text-stone-600">Dodaj wiedzę komendą „zapamiętaj: szkło pakujemy z przekładkami”.</Text></Card>
      {data.procedures.filter(p => `${p.topic} ${p.text}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))).map(procedure =>
        <Card key={procedure.id}><Title>{procedure.topic}</Title><Text className="text-base leading-6 text-ink">{procedure.text}</Text></Card>)}
      {!data.procedures.length ? <Message>Nie zapisano jeszcze żadnej procedury.</Message> : null}
    </> : null}
  </View>
}
