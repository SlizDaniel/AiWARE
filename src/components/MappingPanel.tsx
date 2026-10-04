'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteMapPath, saveMapPath, type MapPath, type PathMarker, type PathPoint, type Zone } from '@/lib/api'
import { PathTracker, StepDetector, circularMean, formatMeters, pathDistanceM } from '@/lib/pdr'
import PathMap from './PathMap'
import { imuSupported, requestImuPermission, startImu, type ImuPermission } from '@/lib/pdrSensors'

type Mode = 'idle' | 'recording' | 'review'

type Snapshot = { points: PathPoint[]; markers: PathMarker[]; startedAt: number }

type Props = {
  paths: MapPath[]
  state: 'loading' | 'ready' | 'error'
  error: string
  onRetry: () => void
  zones: Zone[]
  /** Usuwanie ścieżek — kierownik. */
  canDecide: boolean
  onSaved: (name: string) => void
  onDeleted: (name: string) => void
  onShowOnMap: () => void
}

const HEADING_BUFFER = 8

const EMPTY_SNAPSHOT: Snapshot = { points: [{ x: 0, y: 0, t: 0 }], markers: [], startedAt: 0 }

export default function MappingPanel({ paths, state, error, onRetry, zones, canDecide, onSaved, onDeleted, onShowOnMap }: Props) {
  const [mode, setMode] = useState<Mode>('idle')
  const [manual, setManual] = useState(false)
  const [permission, setPermission] = useState<ImuPermission | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT)
  const [markerLabel, setMarkerLabel] = useState('')
  const [markerZone, setMarkerZone] = useState('')
  const [name, setName] = useState('')
  const [stepLength, setStepLength] = useState(0.7)
  const [busy, setBusy] = useState(false)
  const [panelError, setPanelError] = useState('')

  const trackerRef = useRef<PathTracker | null>(null)
  const detectorRef = useRef<StepDetector | null>(null)
  const stopImuRef = useRef<(() => void) | null>(null)
  const headingsRef = useRef<number[]>([])
  const startedAtRef = useRef(0)
  const lastAccelAtRef = useRef(0)
  const manualRef = useRef(false)
  const watchdogRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const steps = snapshot.points.length - 1
  const distance = useMemo(() => pathDistanceM(snapshot.points), [snapshot.points])
  const elapsedS = mode === 'idle' || !snapshot.startedAt ? 0 : Math.max(0, Math.round((Date.now() - snapshot.startedAt) / 1000))

  const stopSensors = useCallback(() => {
    stopImuRef.current?.()
    stopImuRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => stopSensors, [stopSensors])

  const startTick = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      // Watchdog: przeglądarka raportuje DeviceMotion, ale czujniki milczą (laptop,
      // brak uprawnień systemowych) → po 3,5 s włączamy tryb ręczny zamiast czekać w nieskończoność.
      if (!manualRef.current && !watchdogRef.current && lastAccelAtRef.current === 0 && Date.now() - startedAtRef.current > 3500) {
        watchdogRef.current = true
        manualRef.current = true
        setManual(true)
        setPanelError(
          'Czujniki nie wysyłają danych (typowe dla laptopa) — włączony tryb ręczny: klikaj punkty przejścia na mapie. Na telefonie ścieżka narysuje się sama.',
        )
      }
      const tracker = trackerRef.current
      if (tracker && !manualRef.current) {
        setSnapshot({ points: tracker.allPoints(), markers: tracker.allMarkers(), startedAt: startedAtRef.current })
      }
    }, 200)
  }, [])

  const switchMode = useCallback((next: boolean) => {
    manualRef.current = next
    setManual(next)
  }, [])

  const startRecording = useCallback(async () => {
    setPanelError('')
    setName('')
    watchdogRef.current = false
    lastAccelAtRef.current = 0
    if (imuSupported()) {
      const granted = await requestImuPermission()
      setPermission(granted)
      if (granted === 'granted') {
        const tracker = new PathTracker(stepLength)
        trackerRef.current = tracker
        detectorRef.current = new StepDetector()
        headingsRef.current = []
        startedAtRef.current = Date.now()
        stopImuRef.current = startImu({
          onAccel: (mag, tMs) => {
            lastAccelAtRef.current = Date.now()
            if (detectorRef.current?.push(mag, tMs)) trackerRef.current?.step(Math.max(0, tMs))
          },
          onHeading: (deg) => {
            const buffer = headingsRef.current
            buffer.push(deg)
            if (buffer.length > HEADING_BUFFER) buffer.shift()
            trackerRef.current?.setHeading(circularMean(buffer))
          },
        })
        switchMode(false)
        setSnapshot({ points: tracker.allPoints(), markers: [], startedAt: startedAtRef.current })
        startTick()
        setMode('recording')
        return
      }
      setPanelError(
        granted === 'denied'
          ? 'Brak dostępu do czujników — nagrywam w trybie ręcznym (klikanie punktów).'
          : 'Czujniki wymagają HTTPS (lub localhost) — nagrywam w trybie ręcznym.',
      )
    } else {
      setPermission('unsupported')
      setPanelError('To urządzenie nie udostępnia akcelerometru — nagrywam w trybie ręcznym (klikanie punktów).')
    }
    switchMode(true)
    startedAtRef.current = Date.now()
    setSnapshot({ points: EMPTY_SNAPSHOT.points, markers: [], startedAt: startedAtRef.current })
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
    setPanelError('')
    setMode('idle')
  }, [stopSensors])

  const addMarker = useCallback(() => {
    const label = markerLabel.trim()
    if (!label) return
    const zone = markerZone || undefined
    if (manual) {
      setSnapshot((current) => {
        const last = current.points[current.points.length - 1]!
        const marker: PathMarker = { x: last.x, y: last.y, label }
        if (zone) marker.zone = zone
        return { ...current, markers: [...current.markers, marker] }
      })
    } else {
      trackerRef.current?.addMarker(label, zone)
      const tracker = trackerRef.current
      if (tracker) setSnapshot({ points: tracker.allPoints(), markers: tracker.allMarkers(), startedAt: snapshot.startedAt })
    }
    setMarkerLabel('')
  }, [manual, markerLabel, markerZone, snapshot.startedAt])

  const pickPoint = useCallback((meters: { x: number; y: number }) => {
    setSnapshot((current) => ({
      ...current,
      points: [...current.points, { x: meters.x, y: meters.y, t: Date.now() }],
    }))
  }, [])

  const undoPoint = useCallback(() => {
    if (manual) {
      setSnapshot((current) => (current.points.length > 1 ? { ...current, points: current.points.slice(0, -1) } : current))
    } else {
      setPanelError('Cofanie kroków działa w trybie ręcznym — nagrany krok wychodzi z sygnału czujnika.')
    }
  }, [manual])

  const saveRecording = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setPanelError('')
    try {
      const saved = await saveMapPath({
        name: trimmed,
        step_length: manual ? stepLength : trackerRef.current?.stepLength ?? 0.7,
        points: snapshot.points,
        markers: snapshot.markers,
      })
      onSaved(saved.name)
      cancelRecording()
    } catch (reason) {
      setPanelError(reason instanceof Error ? reason.message : 'Nie udało się zapisać ścieżki.')
    } finally {
      setBusy(false)
    }
  }, [busy, cancelRecording, manual, name, onSaved, snapshot, stepLength])

  const removePath = useCallback(
    async (path: MapPath) => {
      setPanelError('')
      try {
        await deleteMapPath(path.id)
        onDeleted(path.name)
      } catch (reason) {
        setPanelError(reason instanceof Error ? reason.message : 'Nie udało się usunąć ścieżki.')
      }
    },
    [onDeleted],
  )

  const sensorLabel = manual
    ? 'Tryb ręczny — klikaj punkty na mapie'
    : permission === 'granted'
      ? 'Czujniki: akcelerometr + kompas aktywne'
      : permission === 'denied'
        ? 'Czujniki: odmowa dostępu → tryb ręczny'
        : permission === 'insecure'
          ? 'Czujniki: wymagane HTTPS → tryb ręczny'
          : permission === 'unsupported'
            ? 'Czujniki: niedostępne → tryb ręczny'
            : 'Czujniki: sprawdzę przy starcie'

  return (
    <section aria-label="Mapowanie hali telefonem" className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      <div className="border border-[#e8e5de] bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#e8e5de] px-5 py-4">
          <h2 className="text-lg font-bold">Nagraj ścieżkę spacerem</h2>
          <span className="text-xs font-medium uppercase tracking-wider text-[#70756f]">{sensorLabel}</span>
        </div>

        <div className="border-b border-[#e8e5de] bg-[#fbfaf7] px-5 py-4 text-sm leading-6 text-[#454b46]">
          Trzymaj telefon płasko w dłoni i idź powoli po hali. Każdy krok z akcelerometru przesuwa ścieżkę
          o długość kroku, kompas ustawia kierunek. W miejscach składowania dodaj znacznik (np. „A-01”),
          opcjonalnie przypisany do strefy. Zapisana ścieżka pojawi się na mapie magazynu.
        </div>

        <div className="p-3 sm:p-5">
          {mode === 'idle' ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-[#646b64]">Żadna ścieżka nie jest nagrywana.</p>
              <button
                type="button"
                onClick={() => void startRecording()}
                className="bg-[#315b37] px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
              >
                Rozpocznij spacer z telefonem
              </button>
            </div>
          ) : (
            <>
              <PathMap
                shapes={[{ points: snapshot.points, markers: snapshot.markers }]}
                onPick={mode === 'recording' && manual ? pickPoint : undefined}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-[#454b46]" aria-live="polite">
                <span><strong className="tabular-nums">{formatMeters(distance)}</strong> przejścia</span>
                <span><strong className="tabular-nums">{steps}</strong> kroków</span>
                <span><strong className="tabular-nums">{snapshot.markers.length}</strong> znaczników</span>
                <span><strong className="tabular-nums">{elapsedS}</strong> s</span>
                {manual && <span>długość kroku {stepLength.toLocaleString('pl-PL')} m</span>}
              </div>

              {mode === 'recording' && (
                <div className="mt-4 border border-[#cbd8c9] bg-[#f6f8f4] p-4">
                  <p className="text-sm font-semibold text-[#315b37]">Dodaj znacznik w miejscu składowania</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={markerLabel}
                      onChange={(event) => setMarkerLabel(event.target.value)}
                      placeholder="np. A-01"
                      aria-label="Etykieta znacznika"
                      className="w-32 border border-[#d8d6cf] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
                    />
                    <select
                      value={markerZone}
                      onChange={(event) => setMarkerZone(event.target.value)}
                      aria-label="Strefa znacznika (opcjonalnie)"
                      className="border border-[#d8d6cf] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
                    >
                      <option value="">bez strefy</option>
                      {zones.map((zone) => (
                        <option key={zone.id} value={zone.name}>{zone.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addMarker}
                      disabled={!markerLabel.trim()}
                      className="border border-[#315b37] bg-white px-3 py-2 text-sm font-semibold text-[#315b37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:opacity-40"
                    >
                      Dodaj znacznik
                    </button>
                    {manual && (
                      <button
                        type="button"
                        onClick={undoPoint}
                        disabled={snapshot.points.length < 2}
                        className="border border-[#d8d6cf] bg-white px-3 py-2 text-sm font-semibold text-[#646b64] disabled:opacity-40"
                      >
                        Cofnij punkt
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="bg-[#292d2b] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
                    >
                      Zakończ spacer
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode(!manual)}
                      className="border border-[#cbd8c9] bg-white px-4 py-2 text-sm font-semibold text-[#315b37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
                    >
                      {manual ? 'Przełącz na czujniki' : 'Przełącz na tryb ręczny'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelRecording}
                      className="border border-[#d8d6cf] bg-white px-4 py-2 text-sm font-semibold text-[#646b64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56]"
                    >
                      Odrzuć
                    </button>
                  </div>
                </div>
              )}

              {mode === 'review' && (
                <div className="mt-4 border border-[#cbd8c9] bg-[#f6f8f4] p-4">
                  <p className="text-sm font-semibold text-[#315b37]">Zapisz nagraną ścieżkę</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="np. Regały A — korytarz główny"
                      aria-label="Nazwa ścieżki"
                      className="min-w-48 flex-1 border border-[#d8d6cf] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
                    />
                    {manual && (
                      <label className="flex items-center gap-2 text-sm text-[#454b46]">
                        krok [m]
                        <input
                          type="number"
                          min={0.3}
                          max={1.5}
                          step={0.05}
                          value={stepLength}
                          onChange={(event) => setStepLength(Number(event.target.value) || 0.7)}
                          className="w-20 border border-[#d8d6cf] bg-white px-2 py-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveRecording()}
                      disabled={busy || !name.trim()}
                      className="bg-[#315b37] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#536b56] disabled:opacity-40"
                    >
                      {busy ? 'Zapisuję…' : 'Zapisz na mapie'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelRecording}
                      disabled={busy}
                      className="border border-[#d8d6cf] bg-white px-4 py-2 text-sm font-semibold text-[#646b64] disabled:opacity-40"
                    >
                      Odrzuć
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {panelError && (
            <p className="mt-3 border border-[#ead9a9] bg-[#fffaf0] p-3 text-sm text-[#805c12]" role="status">{panelError}</p>
          )}
        </div>
      </div>

      <aside className="border border-[#e8e5de] bg-white p-5" aria-label="Zapisane ścieżki">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Zapisane ścieżki</h2>
          <span className="text-xs font-medium uppercase tracking-wider text-[#70756f]">{paths.length}</span>
        </div>
        {state === 'loading' ? (
          <p className="mt-3 text-sm text-[#646b64]" role="status">Pobieram ścieżki…</p>
        ) : state === 'error' ? (
          <div className="mt-3 text-sm text-[#8f3936]" role="alert">
            <p>{error || 'Nie udało się pobrać ścieżek.'}</p>
            <button type="button" onClick={onRetry} className="mt-2 border border-[#d8a9a5] px-3 py-2 font-semibold">Spróbuj ponownie</button>
          </div>
        ) : paths.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-[#646b64]">
            Jeszcze nic nie zmapowano. Pierwszy spacer wyznaczy rzeczywisty rzut hali na mapie.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[#e8e5de]">
            {paths.map((path) => (
              <li key={path.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-[#454b46]">{path.name}</p>
                  <p className="text-xs text-[#70756f]">
                    {formatMeters(pathDistanceM(path.points))} · {path.points.length} pkt · {path.markers.length} znaczników · {path.created}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={onShowOnMap}
                    className="border border-[#d8d6cf] bg-white px-3 py-2 text-xs font-semibold text-[#454b46] hover:bg-[#f0efe9] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#536b56]"
                  >
                    Na mapie
                  </button>
                  {canDecide && (
                    <button
                      type="button"
                      onClick={() => void removePath(path)}
                      className="border border-[#d8a9a5] bg-white px-3 py-2 text-xs font-semibold text-[#8f3936] hover:bg-[#fff7f6] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8f3936]"
                    >
                      Usuń
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  )
}
