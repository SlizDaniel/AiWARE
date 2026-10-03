import { useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { ImportField, ImportPreview } from '../lib/contracts'
import type { Warehouse } from '../hooks/useWarehouse'

const FIELDS: Record<ImportField, string> = { name: 'Nazwa (wymagana)', quantity: 'Ilość (wymagana)', minimum: 'Minimum', location: 'Lokalizacja', unit: 'Jednostka' }

export function InventoryScreen({ api, data, reload }: { api: Api; data: Warehouse; reload: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<ImportField, number | null>>({ name: null, quantity: null, minimum: null, location: null, unit: null })

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : 'Operacja nie powiodła się.') }
    finally { setBusy(false) }
  }

  async function pickFile() {
    await run(async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], copyToCacheDirectory: true })
      if (result.canceled) return
      const asset = result.assets[0]
      if ((asset.size ?? 0) > 4 * 1024 * 1024) throw new Error('Plik przekracza 4 MB.')
      let bytes: Uint8Array
      if (Platform.OS === 'web') {
        const blob = asset.file ?? await fetch(asset.uri).then(r => r.blob())
        if (!blob) throw new Error('Nie udało się odczytać pliku.')
        bytes = new Uint8Array(await blob.arrayBuffer())
      } else {
        const file = new File(asset.uri)
        try { bytes = await file.bytes() } finally { if (file.exists) file.delete() }
      }
      const resultPreview = await api.previewImport(bytes, asset.name)
      setPreview(resultPreview)
      setMapping(Object.fromEntries(Object.entries(resultPreview.mapping).map(([field, value]) => [field, value.column])) as Record<ImportField, number | null>)
    })
  }

  async function confirmImport() {
    if (!preview) return
    await run(async () => {
      const result = await api.confirmImport(preview.import_id, mapping)
      setPreview(null); setMessage(`Zaimportowano ${result.total} pozycji.`)
      await reload()
    })
  }

  async function exportFile(format: 'csv' | 'xlsx') {
    await run(async () => {
      const bytes = await api.exportInventory(format)
      const name = `magazynier.${format}`
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer]))
        const link = document.createElement('a'); link.href = url; link.download = name; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else {
        const file = new File(Paths.cache, name)
        file.create({ overwrite: true }); file.write(bytes)
        try {
          if (!await Sharing.isAvailableAsync()) throw new Error('Udostępnianie plików jest niedostępne na tym urządzeniu.')
          await Sharing.shareAsync(file.uri, { mimeType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Eksport magazynu' })
        } finally { if (file.exists) file.delete() }
      }
    })
  }

  return <View>
    <Card><Title>Stany magazynowe</Title><Field label="Szukaj pozycji" value={query} onChangeText={setQuery} />
      <Text className="text-sm text-stone-500">{data.items.length} pozycji · {data.items.filter(i => i.quantity < i.minimum).length} poniżej minimum</Text>
      {data.user.role === 'kierownik' ? <Button title={busy ? 'Przetwarzanie…' : 'Importuj Excel / CSV'} secondary onPress={() => void pickFile()} disabled={busy || !!preview} /> : null}
      <View className="flex-row gap-2"><View className="flex-1"><Button title="Eksport CSV" secondary onPress={() => void exportFile('csv')} disabled={busy} /></View>
        <View className="flex-1"><Button title="Eksport XLSX" secondary onPress={() => void exportFile('xlsx')} disabled={busy} /></View></View>
    </Card>
    {error ? <Message error>{error}</Message> : null}{message ? <Message>{message}</Message> : null}
    {preview ? <Card><Title>Mapowanie kolumn</Title><Text className="text-stone-600">{preview.row_count} wierszy · propozycja: {preview.mapping_source === 'llm' ? 'AI' : 'reguły'}. Sprawdź pola przed zapisem.</Text>
      {preview.warnings.map((warning, index) => <Message key={index}>{warning}</Message>)}
      {Object.entries(FIELDS).map(([field, label]) => <View key={field} className="gap-2"><Text className="font-semibold text-ink">{label}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View className="flex-row gap-2">
          {[{ index: null, label: 'Pomiń' }, ...preview.headers].map(column => <Pressable key={column.index ?? 'none'} accessibilityRole="button" disabled={busy}
            onPress={() => setMapping(previous => ({ ...previous, [field]: column.index }))}
            className={`rounded-xl px-3 py-3 ${mapping[field as ImportField] === column.index ? 'bg-forest' : 'bg-paper'}`}>
            <Text className={mapping[field as ImportField] === column.index ? 'text-white' : 'text-ink'}>{column.label}</Text></Pressable>)}
        </View></ScrollView></View>)}
      <Text className="text-sm font-semibold text-ink">Podgląd pierwszych wierszy</Text>
      {preview.preview.slice(0, 3).map((row, index) => <Text key={index} className="text-sm text-stone-600">{row.join(' · ')}</Text>)}
      <Button title="Zatwierdź import" disabled={busy || mapping.name === null || mapping.quantity === null} onPress={() => void confirmImport()} />
      <Button title="Anuluj import" secondary disabled={busy} onPress={() => setPreview(null)} />
    </Card> : null}
    {data.items.filter(item => item.name.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))).map(item =>
      <Card key={item.id}><View className="flex-row items-start justify-between gap-2"><View className="flex-1"><Title>{item.name}</Title><Text className="mt-1 text-stone-500">{item.location || 'Brak lokalizacji'}</Text></View>
        <Text className={`text-2xl font-bold ${item.quantity < item.minimum ? 'text-red-700' : 'text-forest'}`}>{item.quantity} <Text className="text-sm">{item.unit}</Text></Text></View>
        <Text className={item.quantity < item.minimum ? 'text-red-700' : 'text-stone-500'}>Minimum: {item.minimum} {item.unit}{item.quantity < item.minimum ? ' · uzupełnij zapas' : ''}</Text>
      </Card>)}
    {!data.items.length ? <Message>Magazyn jest pusty. Zaimportuj plik lub dodaj pozycję komendą.</Message> : null}
  </View>
}
