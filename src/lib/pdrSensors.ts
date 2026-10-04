// Glue między czujnikami przeglądarki (DeviceMotion/DeviceOrientation) a czystym
// PDR (pdr.ts). Wszystko, co nieprzenośne (uprawnienia iOS, webkitCompassHeading,
// obrót ekranu), siedzi tu — matematyka zostaje testowalna bez przeglądarki.

export type ImuPermission = 'granted' | 'denied' | 'unsupported' | 'insecure'

export type ImuHandlers = {
  /** |a| w m/s² + timestamp [ms] z devicemotion. */
  onAccel: (mag: number, tMs: number) => void
  /** Kierunek „naprzód” telefonu w stopniach kompasu (0 = północ, 90 = wschód). */
  onHeading: (deg: number) => void
}

type PermissionRequestable = { requestPermission?: () => Promise<'granted' | 'denied'> }
type HeadingEvent = Event & { alpha?: number | null; webkitCompassHeading?: number | null }
type MotionEvent = Event & { accelerationIncludingGravity?: { x?: number | null; y?: number | null; z?: number | null } | null }

function motionCtor(): (PermissionRequestable & { new (): EventTarget }) | undefined {
  return (window as unknown as { DeviceMotionEvent?: PermissionRequestable & { new (): EventTarget } }).DeviceMotionEvent
}

function orientationCtor(): (PermissionRequestable & { new (): EventTarget }) | undefined {
  return (window as unknown as { DeviceOrientationEvent?: PermissionRequestable & { new (): EventTarget } }).DeviceOrientationEvent
}

/** Czujniki wymagają HTTPS (albo localhost) — w innym wypadku zostaje tryb ręczny. */
export function imuSupported(): boolean {
  return typeof window !== 'undefined' && motionCtor() !== undefined
}

function secureContext(): boolean {
  return typeof window === 'undefined' || window.isSecureContext !== false
}

/** iOS 13+ wymaga jawnego przyzwolenia na czujniki ruchu; Android daje je od razu. */
export async function requestImuPermission(): Promise<ImuPermission> {
  const motion = motionCtor()
  const orientation = orientationCtor()
  if (!motion) return 'unsupported'
  if (!secureContext()) return 'insecure'
  try {
    if (typeof motion.requestPermission === 'function') {
      const granted = (await motion.requestPermission()) === 'granted'
      if (orientation && typeof orientation.requestPermission === 'function') {
        await orientation.requestPermission()
      }
      return granted ? 'granted' : 'denied'
    }
    return 'granted'
  } catch {
    return 'denied'
  }
}

/** Kompas z eventu orientacji: iOS = webkitCompassHeading, Android = 360 − alpha. */
function compassDeg(event: HeadingEvent): number | null {
  const ios = event.webkitCompassHeading
  if (typeof ios === 'number' && Number.isFinite(ios)) return (ios % 360 + 360) % 360
  const alpha = event.alpha
  if (typeof alpha === 'number' && Number.isFinite(alpha)) return ((360 - alpha) % 360 + 360) % 360
  return null
}

/**
 * Kąt obrotu ekranu — „naprzód” wg użytkownika to góra ekranu, nie top urządzenia
 * (po obrocie telefonu w poziom góra ekranu jest o ±90° względem topu).
 */
function screenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation) return screen.orientation.angle
  return (window as unknown as { orientation?: number }).orientation ?? 0
}

/** Podpina czujniki; zwraca funkcję sprzątającą. */
export function startImu(handlers: ImuHandlers): () => void {
  const onMotion = (raw: Event) => {
    const event = raw as MotionEvent
    const accel = event.accelerationIncludingGravity
    if (!accel) return
    const { x, y, z } = accel
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return
    handlers.onAccel(Math.hypot(x, y, z), event.timeStamp)
  }

  // Android Chrome ma absolutny kompas (deviceorientationabsolute); Safari nie ma
  // tego eventu, ale webkitCompassHeading w deviceorientation jest absolutny.
  const onOrientation = (raw: Event) => {
    const event = raw as HeadingEvent
    const compass = compassDeg(event)
    if (compass === null) return
    // webkitCompassHeading podąża za topem telefonu; alpha korygujemy o obrót ekranu.
    const iosCompass = typeof event.webkitCompassHeading === 'number'
    handlers.onHeading(iosCompass ? compass : ((compass - screenAngle()) % 360 + 360) % 360)
  }

  const hasAbsolute = typeof window !== 'undefined' && 'ondeviceorientationabsolute' in window
  window.addEventListener('devicemotion', onMotion)
  // Chrome: absolutny event; Safari: tylko deviceorientation (webkitCompassHeading).
  window.addEventListener(hasAbsolute ? 'deviceorientationabsolute' : 'deviceorientation', onOrientation as EventListener)

  return () => {
    window.removeEventListener('devicemotion', onMotion)
    window.removeEventListener(hasAbsolute ? 'deviceorientationabsolute' : 'deviceorientation', onOrientation as EventListener)
  }
}
