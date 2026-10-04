import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { itemsForZone, zoneForItem } from '../../../src/components/zoneItems'
import { formatMeters, pathDistanceM, PathTracker, StepDetector, type PathMarker, type PathPoint } from '../../../src/lib/pdr'
import { Button, Card, Field, Message, Title } from '../components/ui'
import type { Api } from '../lib/client'
import type { MapPath, MapSector } from '../lib/contracts'
import { attachTrackerToImu, createImuTracker, imuAvailable, requestImuPermission, type ImuTracker } from '../lib/imu'
import { CANVAS_H, CANVAS_W, canvasGeometry, tapToMeters, type CanvasGeometry } from '../lib/mapping'
import type { Warehouse } from '../hooks/useWarehouse'

export type MapTarget = { name: string; location: string }

type Mode = 'idle' | 'recording' | 'review'
type Snapshot = { points: PathPoint[]; markers: PathMarker[] }

const EMPTY_SNAPSHOT: Snapshot = { points: [{ x: 0, y: 0, t: 0 }], markers: [] }
const HEADING_WATCHDOG_MS = 3500

/** Mapa magazynu: rzeczywisty rzut ze spaceru z telefonem, sektory i schemat stref. */
export function MapScreen({ api, data, target }: { api: Api; data: Warehouse; target: MapTarget | null }) {
  const canDecide = data.user.role === 'kierownik'
  const [paths, setPaths] = useState<MapPath[]>([])
  const [sectors, setSectors] = useState<MapSector[]>([])
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [info, setInfo] = useState('')

  const [mode, setMode] = useState<Mode>('idle')
  const [manual, setManual] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT)
  const [markerLabel, setMarkerLabel] = useState('')
  const [markerZone, setMarkerZone] = useState('')
  const [name, setName] = useState('')
  const [stepLength, setStepLength] = useState('0.7')
  const [busy, setBusy] = useState(false)

  const [addSectorMode, setAddSectorMode] = useState(false)
  const [pendingSector, setPendingSector] = useState<{ x: number; y: number } | null>(null)
  const [sectorName, setSectorName] = useState('')
  const [selectedSectorId, setSelectedSectorId] = useState<number | null>(null)
  const [assignmentQty, setAssignmentQty] = useState<Record<number, string>>({})

  const [selected, setSelected] = useState<number | null>(null)
  const highlighted = target ? zoneForItem(target, data.zones) : null
  const zone = data.zones.find(item => item.id === selected) ?? highlighted

  const trackerRef = useRef<PathTracker | null>(null)
  const detectorRef = useRef<StepDetector | null>(null)
  const imuRef = useRef<ImuTracker | null>(null)
  const startedAtRef = useRef(0)
  const lastAccelAtRef = useRef(0)
  const manualRef = useRef(false)
  const watchdogRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadMap = useCallback(async () => {
    try {
      const [loadedPaths, loadedSectors] = await Promise.all([api.mapPaths(), api.mapSectors()])
      setPaths(loadedPaths)
      setSectors(loadedSectors)
      setLoadError('')
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'Nie udało się pobrać mapy.')
    }
  }, [api])

  // Odświeżaj razem z pullem magazynu (items zmieniają się tylko po zapisach — rzadko).
  const itemsKey = data.items
  useEffect(() => { void loadMap() }, [loadMap, itemsKey])

  const stopSensors = useCallback(() => {
    imuRef.current?.stop()
    imuRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => stopSensors, [stopSensors])

  const startTick = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      // Watchdog: czujniki raportowane, ale milczą (laptop, brak zgody systemowej) → tryb ręczny.
      if (!manualRef.current && !watchdogRef.current && lastAccelAtRef.current === 0 && Date.now() - startedAtRef.current > HEADING_WATCHDOG_MS) {
        watchdogRef.current = true
        manualRef.current = true
        setManual(true)
        setInfo('Czujniki nie wysyłają danych — włączony tryb ręczny: dotykaj punktów przejścia na mapie.')
      }
      const tracker = trackerRef.current
      if (tracker && !manualRef.current) {
        setSnapshot({ points: tracker.allPoints(), markers: tracker.allMarkers() })
      }
    }, 200)
  }, [])

  const switchMode = useCallback((next: boolean) => {
    manualRef.current = next
    setManual(next)
  }, [])

  const startRecording = useCallback(async () => {
    setActionError('')
    setInfo('')
    setName('')
    watchdogRef.current = false
    lastAccelAtRef.current = 0
    startedAtRef.current = Date.now()
    if (imuAvailable()) {
      try {
        const granted = await requestImuPermission()
        if (granted) {
          const tracker = new PathTracker(Number(stepLength) || 0.7)
          trackerRef.current = tracker
          const detector = new StepDetector()
          detectorRef.current = detector
          const imu = createImuTracker(detector, tMs => trackerRef.current?.step(Math.max(0, tMs)), deg => trackerRef.current?.setHeading(deg))
          imuRef.current = imu
          await attachTrackerToImu(tracker, detector, imu)
          switchMode(false)
          setSnapshot({ points: tracker.allPoints(), markers: [] })
          startTick()
          setMode('recording')
          return
        }
        setInfo('Brak zgody na czujniki — nagrywam w trybie ręcznym (dotykanie punktów).')
      } catch (reason) {
        setInfo(reason instanceof Error ? reason.message : 'Czujniki niedostępne — nagrywam w trybie ręcznym.')
      }
    } else {
      setInfo('To urządzenie nie ma czujników ruchu — nagrywam w trybie ręcznym.')
    }
    switchMode(true)
    setSnapshot(EMPTY_SNAPSHOT)
    startTick()
    setMode('recording')
  }, [startTick, stepLength, switchMode])

  const stopRecording = useCallback(() => {
    stopSensors()
    setMode('review')
  }, [stopSensors])

  const cancelRecording = useCallback(() => {
    stopSensors()
    trackerRef.current = null
    detectorRef.current = null
    setSnapshot(EMPTY_SNAPSHOT)
    setName('')
    setMode('idle')
  }, [stopSensors])

  const syncFromTracker = useCallback(() => {
    const tracker = trackerRef.current
    if (tracker) setSnapshot({ points: tracker.allPoints(), markers: tracker.allMarkers() })
  }, [])

  const addMarker = useCallback(() => {
    const label = markerLabel.trim()
    if (!label) return
    const zoneName = markerZone || undefined
    if (manualRef.current) {
      setSnapshot(current => {
        const last = current.points[current.points.length - 1]!
        const marker: PathMarker = { x: last.x, y: last.y, label }
        if (zoneName) marker.zone = zoneName
        return { ...current, markers: [...current.markers, marker] }
      })
    } else {
      trackerRef.current?.addMarker(label, zoneName)
      syncFromTracker()
    }
    setMarkerLabel('')
  }, [markerLabel, markerZone, syncFromTracker])

  const recordingShapes: MapPath[] = useMemo(
    () => (mode === 'idle' ? [] : [{ id: -1, name: '', points: snapshot.points, markers: snapshot.markers, step_length: 0.7, actor: '', created: '' }]),
    [mode, snapshot],
  )
  const geometry: CanvasGeometry = useMemo(
    () => canvasGeometry([...recordingShapes, ...paths], sectors),
    [recordingShapes, paths, sectors],
  )

  const handleCanvasPress = useCallback((locationX: number, locationY: number) => {
    const meters = tapToMeters(geometry.proj, locationX, locationY)
    if (addSectorMode && mode !== 'recording') {
      setPendingSector(meters)
      setSectorName('')
      return
    }
    if (mode === 'recording' && manualRef.current) {
      setSnapshot(current => ({ ...current, points: [...current.points, { x: meters.x, y: meters.y, t: Date.now() }] }))
    }
  }, [addSectorMode, geometry, mode])

  const saveRecording = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setActionError('')
    try {
      const saved = await api.saveMapPath({
        name: trimmed,
        step_length: manualRef.current ? Number(stepLength) || 0.7 : trackerRef.current?.stepLength ?? 0.7,
        points: snapshot.points,
        markers: snapshot.markers,
      })
      setPaths(current => [saved, ...current])
      setInfo(`Zapisano ścieżkę: ${saved.name}`)
      cancelRecording()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Nie udało się zapisać ścieżki.')
    } finally {
      setBusy(false)
    }
  }, [api, busy, cancelRecording, name, snapshot, stepLength])

  const removePath = useCallback(async (path: MapPath) => {
    setActionError('')
    try {
      await api.deleteMapPath(path.id)
      setPaths(current => current.filter(item => item.id !== path.id))
      setInfo(`Usunięto ścieżkę: ${path.name}`)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Nie udało się usunąć ścieżki.')
    }
  }, [api])

  const saveSector = useCallback(async () => {
    const trimmed = sectorName.trim()
    if (!trimmed || !pendingSector || busy) return
    setBusy(true)
    setActionError('')
    try {
      const sector = await api.createMapSector({ name: trimmed, x: pendingSector.x, y: pendingSector.y })
      setSectors(current => [...current, sector])
      setSelectedSectorId(sector.id)
      setSectorName('')
      setPendingSector(null)
      setAddSectorMode(false)
      setInfo(`Dodano sektor: ${sector.name}`)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Nie udało się dodać sektora.')
    } finally {
      setBusy(false)
    }
  }, [api, busy, pendingSector, sectorName])

  const removeSector = useCallback(async (sector: MapSector) => {
    setActionError('')
    try {
      await api.deleteMapSector(sector.id)
      setSectors(current => current.filter(item => item.id !== sector.id))
      setSelectedSectorId(null)
      setInfo(`Usunięto sektor: ${sector.name}`)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Nie udało się usunąć sektora.')
    }
  }, [api])

  const assignItem = useCallback(async (sector: MapSector, itemId: number) => {
    const quantity = Math.round(Number(assignmentQty[itemId] ?? '1')) || 1
    setBusy(true)
    setActionError('')
    try {
      const updated = await api.assignSectorItem(sector.id, { item_id: itemId, quantity })
      setSectors(current => current.map(item => (item.id === updated.id ? updated : item)))
      setAssignmentQty(current => ({ ...current, [itemId]: '1' }))
      setInfo(`Przypisano do sektora „${sector.name}”`)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Nie udało się przypisać przedmiotu.')
    } finally {
      setBusy(false)
    }
  }, [api, assignmentQty])

  const unassignItem = useCallback(async (sector: MapSector, itemId: number) => {
    setBusy(true)
    setActionError('')
    try {
      const updated = await api.unassignSectorItem(sector.id, itemId)
      setSectors(current => current.map(item => (item.id === updated.id ? updated : item)))
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Nie udało się usunąć przypisania.')
    } finally {
      setBusy(false)
    }
  }, [api])

  const selectedSector = sectors.find(item => item.id === selectedSectorId) ?? null
  const assignedIds = new Set(selectedSector?.items.map(item => item.item_id) ?? [])
  const assignableItems = data.items.filter(item => !assignedIds.has(item.id))
  const steps = mode === 'idle' ? 0 : snapshot.points.length - 1
  const distance = pathDistanceM(mode === 'idle' ? [] : snapshot.points)

  return <View className="gap-3">
    <Card>
      <Title>Mapa magazynu</Title>
      <Text className="text-stone-600">
        Rzeczywisty rzut ze spaceru z telefonem{paths.length ? ` · ${paths.length} ścieżek` : ' · zmapuj halę poniżej'} · kratka {geometry.gridStepM} m
      </Text>
      {target ? <Message>{target.name}: {target.location || 'brak zapisanej lokalizacji'}{!highlighted ? ' · nie znaleziono odpowiadającej strefy' : ''}</Message> : null}
      {loadError ? <Message error>{loadError}</Message> : null}
      {info ? <Message>{info}</Message> : null}
      {actionError ? <Message error>{actionError}</Message> : null}

      <Pressable accessibilityLabel="Rzeczywista mapa magazynu w metrach" onPress={event => handleCanvasPress(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        style={{ width: CANVAS_W, height: CANVAS_H }} className="mt-3 self-center overflow-hidden rounded-lg border border-stone-300 bg-[#fbfaf7]">
        <View style={{ width: CANVAS_W, height: CANVAS_H }}>
          {Array.from({ length: Math.floor(CANVAS_W / (geometry.gridStepM * geometry.proj.scale)) + 1 }, (_, index) => {
            const x = index * geometry.gridStepM * geometry.proj.scale
            return <View key={`v${index}`} style={{ position: 'absolute', left: x, top: 0, width: 1, height: CANVAS_H, backgroundColor: '#e7e5de' }} />
          })}
          {Array.from({ length: Math.floor(CANVAS_H / (geometry.gridStepM * geometry.proj.scale)) + 1 }, (_, index) => {
            const y = index * geometry.gridStepM * geometry.proj.scale
            return <View key={`h${index}`} style={{ position: 'absolute', left: 0, top: y, width: CANVAS_W, height: 1, backgroundColor: '#e7e5de' }} />
          })}
          {geometry.segments.map(segment => <View key={segment.key} style={{
            position: 'absolute', left: segment.left, top: segment.top, width: segment.length, height: 2.5,
            backgroundColor: segment.color, transform: [{ rotate: `${segment.angleDeg}deg` }],
          }} />)}
          <View style={{ position: 'absolute', left: geometry.start.left - 5, top: geometry.start.top - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#315b45' }} />
          <Text style={{ position: 'absolute', left: geometry.start.left + 7, top: geometry.start.top - 7 }} className="text-[10px] font-bold text-forest">START</Text>
          {geometry.markers.map(marker => <View key={marker.key} style={{ position: 'absolute', left: marker.left, top: marker.top }}>
            <View style={{ width: 10, height: 10, backgroundColor: marker.color }} />
            <Text className="text-[10px] font-semibold text-ink">{marker.label}</Text>
          </View>)}
          {geometry.sectors.map(sector => <Pressable key={sector.key} hitSlop={6} onPress={() => setSelectedSectorId(current => (current === Number(sector.key.slice(2)) ? null : Number(sector.key.slice(2))))}
            style={{ position: 'absolute', left: sector.left, top: sector.top }}>
            <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: sector.color, borderWidth: sector.active ? 3 : 1, borderColor: sector.active ? '#1d2f45' : '#ffffff' }} />
            <Text className="text-[11px] font-bold text-[#1d2f45]">{sector.label}</Text>
          </Pressable>)}
        </View>
      </Pressable>

      {mode === 'idle' ? (
        <View className="mt-3 gap-2">
          <Button title="Rozpocznij spacer z telefonem" onPress={() => void startRecording()} disabled={busy} />
          <Text className="text-xs text-stone-500">
            Trzymaj telefon płasko i idź powoli: kroki z akcelerometru rysują ścieżkę, magnetometr ustawia kierunek.
            Bez czujników działa tryb ręczny — dotykaj punktów na mapie.
          </Text>
        </View>
      ) : (
        <View className="mt-3 gap-2">
          <View className="flex-row flex-wrap gap-x-4 gap-y-1">
            <Text className="text-sm text-ink">{formatMeters(distance)} przejścia</Text>
            <Text className="text-sm text-ink">{steps} kroków</Text>
            <Text className="text-sm text-ink">{snapshot.markers.length} znaczników</Text>
            {manual ? <Text className="text-sm text-stone-500">tryb ręczny · krok {stepLength} m</Text> : null}
          </View>
          {mode === 'recording' ? (
            <View className="gap-2 rounded-xl border border-stone-200 bg-paper p-3">
              <Text className="text-sm font-semibold text-forest">Znacznik w miejscu składowania</Text>
              <Field label="Etykieta (np. A-01)" value={markerLabel} onChangeText={setMarkerLabel} />
              <View className="flex-row flex-wrap gap-2">
                <Pressable accessibilityRole="button" onPress={() => setMarkerZone('')}
                  className={`rounded-full border px-3 py-1.5 ${markerZone === '' ? 'border-forest bg-accent' : 'border-stone-300 bg-white'}`}>
                  <Text className="text-xs text-ink">bez strefy</Text>
                </Pressable>
                {data.zones.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => setMarkerZone(item.name)}
                  className={`rounded-full border px-3 py-1.5 ${markerZone === item.name ? 'border-forest bg-accent' : 'border-stone-300 bg-white'}`}>
                  <Text className="text-xs text-ink">{item.name}</Text>
                </Pressable>)}
              </View>
              <Button title="Dodaj znacznik" secondary disabled={!markerLabel.trim()} onPress={addMarker} />
              {manual ? <Button title="Cofnij ostatni punkt" secondary disabled={snapshot.points.length < 2}
                onPress={() => setSnapshot(current => (current.points.length > 1 ? { ...current, points: current.points.slice(0, -1) } : current))} /> : null}
              <View className="flex-row gap-2">
                <View className="flex-1"><Button title="Zakończ spacer" onPress={stopRecording} /></View>
                <View className="flex-1"><Button title={manual ? 'Na czujniki' : 'Tryb ręczny'} secondary onPress={() => switchMode(!manual)} /></View>
              </View>
              <Button title="Odrzuć" secondary onPress={cancelRecording} />
            </View>
          ) : (
            <View className="gap-2 rounded-xl border border-stone-200 bg-paper p-3">
              <Text className="text-sm font-semibold text-forest">Zapisz nagraną ścieżkę</Text>
              <Field label="Nazwa ścieżki" value={name} onChangeText={setName} />
              {manual ? <Field label="Długość kroku [m]" value={stepLength} onChangeText={setStepLength} /> : null}
              <View className="flex-row gap-2">
                <View className="flex-1"><Button title={busy ? 'Zapisuję…' : 'Zapisz na mapie'} onPress={() => void saveRecording()} disabled={busy || !name.trim()} /></View>
                <View className="flex-1"><Button title="Odrzuć" secondary onPress={cancelRecording} disabled={busy} /></View>
              </View>
            </View>
          )}
        </View>
      )}
    </Card>

    <Card>
      <View className="flex-row items-center justify-between">
        <Title>Sektory</Title>
        <Button title={addSectorMode ? 'Anuluj' : 'Dodaj sektor'} secondary={!addSectorMode} disabled={mode !== 'idle'}
          onPress={() => { setAddSectorMode(current => !current); setPendingSector(null); setActionError('') }} />
      </View>
      {mode !== 'idle' ? <Text className="text-xs text-stone-500">Dokończ nagrywanie ścieżki, żeby edytować sektory.</Text> : null}
      {addSectorMode && mode === 'idle' ? (
        pendingSector ? (
          <View className="mt-2 gap-2 rounded-xl border border-stone-200 bg-paper p-3">
            <Text className="text-xs text-stone-600">Punkt: {pendingSector.x.toLocaleString('pl-PL')} m, {pendingSector.y.toLocaleString('pl-PL')} m</Text>
            <Field label="Nazwa sektora" value={sectorName} onChangeText={setSectorName} />
            <View className="flex-row gap-2">
              <View className="flex-1"><Button title={busy ? 'Zapisuję…' : 'Zapisz sektor'} onPress={() => void saveSector()} disabled={busy || !sectorName.trim()} /></View>
              <View className="flex-1"><Button title="Inne miejsce" secondary onPress={() => setPendingSector(null)} /></View>
            </View>
          </View>
        ) : (
          <Text className="mt-2 text-xs text-stone-600">Dotknij miejsca na mapie, żeby tam umieścić sektor.</Text>
        )
      ) : null}
      {sectors.length ? (
        <View className="mt-2 gap-1">
          {sectors.map(sector => <Pressable key={sector.id} accessibilityRole="button" accessibilityState={{ selected: selectedSectorId === sector.id }}
            onPress={() => setSelectedSectorId(current => (current === sector.id ? null : sector.id))}
            className={`flex-row items-center justify-between rounded-xl border-2 px-3 py-2 ${selectedSectorId === sector.id ? 'border-forest bg-accent' : 'border-stone-200 bg-paper'}`}>
            <Text className="text-base font-semibold text-ink">{sector.name}</Text>
            <Text className="text-sm text-stone-600">{sector.items.length} przedmiotów</Text>
          </Pressable>)}
        </View>
      ) : null}
      {selectedSector ? (
        <View className="mt-2 gap-2 rounded-xl border border-stone-200 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-ink">{selectedSector.name}</Text>
            <Text className="text-xs text-stone-500">{selectedSector.x.toLocaleString('pl-PL')} m, {selectedSector.y.toLocaleString('pl-PL')} m</Text>
          </View>
          <Text className="text-xs font-semibold uppercase tracking-wide text-stone-500">Przypisane przedmioty</Text>
          {selectedSector.items.length ? selectedSector.items.map(assignment => <View key={assignment.item_id} className="flex-row items-center justify-between gap-2 border-b border-stone-100 py-2">
            <View className="flex-1">
              <Text className="text-sm font-medium text-ink">{assignment.item_name}</Text>
              <Text className="text-xs text-stone-600">{assignment.quantity} {assignment.unit} w sektorze</Text>
            </View>
            <Button title="Usuń" secondary disabled={busy} onPress={() => void unassignItem(selectedSector, assignment.item_id)} />
          </View>) : <Text className="text-sm text-stone-500">Jeszcze nic — przypisz pierwszy przedmiot poniżej.</Text>}
          {assignableItems.length ? assignableItems.map(item => <View key={item.id} className="flex-row items-center justify-between gap-2 border-t border-stone-100 py-2">
            <Text className="flex-1 text-sm text-ink">{item.name} (stan {item.quantity} {item.unit})</Text>
            <View style={{ width: 64 }}>
              <Field label="Ilość" value={assignmentQty[item.id] ?? '1'} onChangeText={value => setAssignmentQty(current => ({ ...current, [item.id]: value }))} />
            </View>
            <Button title="Przypisz" disabled={busy} onPress={() => void assignItem(selectedSector, item.id)} />
          </View>) : <Text className="text-sm text-stone-500">Brak przedmiotów do przypisania — dodaj je w Stanach.</Text>}
          {canDecide ? <Button title="Usuń sektor" danger disabled={busy} onPress={() => void removeSector(selectedSector)} /> : null}
        </View>
      ) : null}
    </Card>

    <Card>
      <Title>Zapisane ścieżki</Title>
      {paths.length ? paths.map(path => <View key={path.id} className="flex-row items-center justify-between gap-2 border-b border-stone-100 py-2">
        <View className="flex-1">
          <Text className="text-sm font-semibold text-ink">{path.name}</Text>
          <Text className="text-xs text-stone-600">{formatMeters(pathDistanceM(path.points))} · {path.points.length} pkt · {path.markers.length} znaczników</Text>
        </View>
        {canDecide ? <Button title="Usuń" secondary disabled={busy} onPress={() => void removePath(path)} /> : null}
      </View>) : <Text className="text-sm text-stone-500">Jeszcze nic nie zmapowano — pierwszy spacer wyznaczy rzeczywisty rzut.</Text>}
    </Card>

    <Card>
      <Title>Schemat stref</Title>
      <Text className="text-stone-600">Dotknij strefy, aby zobaczyć jej zawartość. Strefy tworzy komendą „strefa: kartony”.</Text>
      <View className="mt-2 flex-row flex-wrap justify-between gap-y-3">
        {data.zones.map(item => {
          const active = (selected ?? highlighted?.id) === item.id
          const zoneItems = itemsForZone(item, data.items, data.zones)
          return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }}
            onPress={() => setSelected(item.id)} className={`min-h-28 w-[48%] rounded-2xl border-2 p-4 ${active ? 'border-forest bg-accent' : 'border-stone-200 bg-paper'}`}>
            <Text className="text-lg font-bold text-ink">{item.name}</Text><Text className="mt-2 text-sm text-stone-600">{zoneItems.length} pozycji</Text>
            {zoneItems.some(zoneItem => zoneItem.quantity < zoneItem.minimum) ? <Text className="mt-1 text-xs font-semibold text-red-700">Niski zapas</Text> : null}
          </Pressable>
        })}
      </View>
      {!data.zones.length ? <Message>Dodaj strefę komendą „strefa: kartony”.</Message> : null}
      {zone ? <Card><Title>{zone.name}</Title>{itemsForZone(zone, data.items, data.zones).map(item =>
        <View key={item.id} className="flex-row justify-between gap-3"><Text className="flex-1 text-base text-ink">{item.name}</Text><Text className="font-semibold text-forest">{item.quantity} {item.unit}</Text></View>)}
        {!itemsForZone(zone, data.items, data.zones).length ? <Text className="text-stone-500">Brak pozycji przypisanych do tej strefy.</Text> : null}</Card> : null}
    </Card>
  </View>
}
