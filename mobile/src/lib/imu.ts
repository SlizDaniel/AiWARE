// Czujniki telefonu dla mapowania hali w kliencie mobilnym: akcelerometr →
// kroki (wspólny StepDetector z webem), magnetometr → kierunek. expo-sensors
// importowane leniwie — moduł (i jego czysta matematyka) ładuje się także w testach.
import { circularMean, StepDetector, type PathTracker } from '../../../src/lib/pdr'

export const HEADING_BUFFER = 8
const STEP_INTERVAL_MS = 60
const MAGNETOMETER_INTERVAL_MS = 200

/**
 * Kompas z magnetometru przy telefonie trzymanym płasko (ekranem do góry, portret):
 * oś +y urządzenia wskazuje w przybliżeniu „przed” (górę ekranu), +x w prawo.
 * Nagłówek = kąt od północy (0°) clockwise, korygowany o obrót ekranu.
 * Deklinację magnetyczną pomijamy — mapowanie jest względne wobec startu.
 */
export function compassHeadingDeg(mx: number, my: number, screenAngle = 0): number {
  const heading = Math.atan2(mx, my) * 180 / Math.PI
  return ((heading - screenAngle) % 360 + 360) % 360
}

export type ImuSampleHandlers = {
  /** |a| w m/s² + timestamp [ms] z akcelerometru. */
  onAccel: (mag: number, tMs: number) => void
  onHeading: (deg: number) => void
}

export type ImuTracker = {
  /** Rejestruje listenerów czujników; rzuca, gdy czujniki są niedostępne. */
  start: (handlers: ImuSampleHandlers) => Promise<void>
  stop: () => void
}

type MotionSensor = {
  isAvailableAsync: () => Promise<boolean>
  setUpdateInterval: (ms: number) => void
  addListener: (listener: (event: { accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null }) => void) => { remove: () => void }
  requestPermissionsAsync?: () => Promise<{ granted: boolean }>
}
type MagnetometerSensor = {
  isAvailableAsync: () => Promise<boolean>
  setUpdateInterval: (ms: number) => void
  addListener: (listener: (event: { x: number; y: number; z: number }) => void) => { remove: () => void }
}

type Sensors = { DeviceMotion: MotionSensor; Magnetometer: MagnetometerSensor }

async function loadSensors(): Promise<Sensors> {
  try {
    // Import leniwy — brak modułu nie blokuje ładowania mapy i trybu ręcznego.
    const sensors = await import('expo-sensors') as Sensors
    if (!sensors?.DeviceMotion) throw new Error('brak modułu ruchu')
    return sensors
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : String(reason)
    throw new Error(`Nie udało się załadować czujników: ${detail}. Włączono tryb ręczny.`)
  }
}

/** Czy urządzenie udostępnia czujniki ruchu (Expo Go / build deweloperski). */
export async function imuAvailable(): Promise<boolean> {
  const sensors = await loadSensors()
  const [motion, magnetometer] = await Promise.all([
    sensors.DeviceMotion.isAvailableAsync(),
    sensors.Magnetometer.isAvailableAsync(),
  ])
  return motion && magnetometer
}

/** Guided mapping needs motion samples only: compass is deliberately unused. */
export async function motionAvailable(): Promise<boolean> {
  const sensors = await loadSensors()
  return sensors.DeviceMotion.isAvailableAsync()
}

export function createStepTracker(): ImuTracker {
  let subscription: { remove: () => void } | null = null
  return {
    async start(handlers) {
      subscription?.remove()
      subscription = null
      const sensors = await loadSensors()
      sensors.DeviceMotion.setUpdateInterval(STEP_INTERVAL_MS)
      subscription = sensors.DeviceMotion.addListener(event => {
        const a = event.accelerationIncludingGravity
        if (!a || a.x == null || a.y == null || a.z == null) return
        if (![a.x, a.y, a.z].every(Number.isFinite)) return
        handlers.onAccel(Math.hypot(a.x, a.y, a.z), Date.now())
      })
    },
    stop() { subscription?.remove(); subscription = null },
  }
}

/** Prosi o pozwolenie iOS na czujniki ruchu; zwraca, czy można słuchać. */
export async function requestImuPermission(): Promise<boolean> {
  const sensors = await loadSensors()
  if (typeof sensors.DeviceMotion.requestPermissionsAsync !== 'function') return true
  const { granted } = await sensors.DeviceMotion.requestPermissionsAsync()
  return granted
}

/**
 * Pętla czujników: kroki wykrywa wspólny StepDetector (pdr.ts), kierunek jest
 * wygładzany średnią kątową z ostatnich próbek magnetometru.
 */
export function createImuTracker(detector: StepDetector, onStep: (tMs: number) => void, onHeading: (deg: number) => void): ImuTracker {
  const headings: number[] = []
  let subscriptions: (() => void)[] = []
  return {
    async start(handlers: ImuSampleHandlers) {
      subscriptions.forEach(remove => remove())
      subscriptions = []
      headings.length = 0
      const sensors = await loadSensors()
      sensors.DeviceMotion.setUpdateInterval(STEP_INTERVAL_MS)
      sensors.Magnetometer.setUpdateInterval(MAGNETOMETER_INTERVAL_MS)
      const motion = sensors.DeviceMotion.addListener(event => {
        const gravity = event.accelerationIncludingGravity
        if (!gravity || gravity.x == null || gravity.y == null || gravity.z == null) return
        if (![gravity.x, gravity.y, gravity.z].every(Number.isFinite)) return
        handlers.onAccel(Math.hypot(gravity.x, gravity.y, gravity.z), Date.now())
      })
      subscriptions = [() => motion.remove()]
      try {
        const magnetometer = sensors.Magnetometer.addListener(event => {
          if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return
          headings.push(compassHeadingDeg(event.x, event.y))
          if (headings.length > HEADING_BUFFER) headings.shift()
          onHeading(circularMean(headings))
        })
        subscriptions.push(() => magnetometer.remove())
      } catch (reason) {
        subscriptions.forEach(remove => remove())
        subscriptions = []
        throw reason
      }
    },
    stop() {
      subscriptions.forEach(remove => remove())
      subscriptions = []
      detector.reset()
    },
  }
}

/** Skleja czujniki z trackerem ścieżki: krok → nowy punkt, nagłówek → kierunek. */
export function attachTrackerToImu(tracker: PathTracker, detector: StepDetector, imu: ImuTracker, onAccel?: (tMs: number) => void): Promise<void> {
  return imu.start({
    onAccel: (mag, tMs) => {
      onAccel?.(tMs)
      if (detector.push(mag, tMs)) tracker.step(Math.max(0, tMs))
    },
    onHeading: deg => tracker.setHeading(deg),
  })
}
