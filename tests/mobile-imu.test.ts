import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { attachTrackerToImu, createImuTracker, createStepTracker, imuAvailable, motionAvailable, requestImuPermission } from '../mobile/src/lib/imu'
import { PathTracker, StepDetector } from '../src/lib/pdr'

const moduleState = vi.hoisted(() => ({ error: null as Error | null, sensors: {} as Record<string, unknown> }))
vi.mock('../mobile/node_modules/expo-sensors/build/index.js', () => ({
  get DeviceMotion() {
    if (moduleState.error) throw moduleState.error
    return moduleState.sensors.DeviceMotion
  },
  get Magnetometer() { return moduleState.sensors.Magnetometer },
}))
beforeEach(() => { moduleState.error = null })

function mockSensors() {
  let emitMotion: (event: { accelerationIncludingGravity: { x: number; y: number; z: number } }) => void = () => {}
  let emitHeading: (event: { x: number; y: number; z: number }) => void = () => {}
  const removeMotion = vi.fn()
  const removeHeading = vi.fn()
  const sensors = {
    DeviceMotion: {
      isAvailableAsync: vi.fn(async () => true),
      requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
      setUpdateInterval: vi.fn(),
      addListener: vi.fn((listener: typeof emitMotion) => { emitMotion = listener; return { remove: removeMotion } }),
    },
    Magnetometer: {
      isAvailableAsync: vi.fn(async () => true),
      setUpdateInterval: vi.fn(),
      addListener: vi.fn((listener: typeof emitHeading) => { emitHeading = listener; return { remove: removeHeading } }),
    },
  }
  moduleState.sensors = sensors
  return { sensors, removeMotion, removeHeading, motion: (z: number) => emitMotion({ accelerationIncludingGravity: { x: 0, y: 0, z } }), heading: () => emitHeading({ x: 50, y: 0, z: 0 }) }
}

afterEach(() => { vi.restoreAllMocks() })

describe('mobile IMU', () => {
  it('guided scanning works with motion alone and never subscribes to the compass', async () => {
    const sensor = mockSensors()
    sensor.sensors.Magnetometer.isAvailableAsync.mockResolvedValue(false)
    expect(await motionAvailable()).toBe(true)
    const tracker = createStepTracker()
    const onAccel = vi.fn()
    const onHeading = vi.fn()
    await tracker.start({ onAccel, onHeading })
    sensor.motion(9.81)
    sensor.motion(Infinity)
    expect(onAccel).toHaveBeenCalledTimes(1)
    expect(sensor.sensors.Magnetometer.isAvailableAsync).not.toHaveBeenCalled()
    expect(sensor.sensors.Magnetometer.addListener).not.toHaveBeenCalled()
    expect(onHeading).not.toHaveBeenCalled()
    tracker.stop()
    tracker.stop()
    expect(sensor.removeMotion).toHaveBeenCalledTimes(1)
  })
  it('checks native sensor availability rather than merely module presence', async () => {
    const { sensors } = mockSensors()
    expect(await imuAvailable()).toBe(true)
    sensors.Magnetometer.isAvailableAsync.mockResolvedValue(false)
    expect(await imuAvailable()).toBe(false)
    expect(sensors.DeviceMotion.isAvailableAsync).toHaveBeenCalledTimes(2)
  })

  it('preserves module load errors for diagnostics', async () => {
    moduleState.error = new Error('Cannot find native module ExponentDeviceMotion')
    await expect(imuAvailable()).rejects.toThrow('Cannot find native module ExponentDeviceMotion')
  })

  it('reports permission denial', async () => {
    const { sensors } = mockSensors()
    sensors.DeviceMotion.requestPermissionsAsync.mockResolvedValue({ granted: false })
    expect(await requestImuPermission()).toBe(false)
  })

  it('reports every valid acceleration sample even without a detected step', async () => {
    const sensor = mockSensors()
    const detector = new StepDetector()
    const path = new PathTracker()
    const onSample = vi.fn()
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    const imu = createImuTracker(detector, () => {}, deg => path.setHeading(deg))
    await attachTrackerToImu(path, detector, imu, onSample)
    sensor.motion(9.81)
    sensor.motion(9.81)
    sensor.motion(NaN)
    sensor.heading()
    expect(onSample.mock.calls).toEqual([[5000], [5000]])
    expect(path.allPoints()).toHaveLength(1)
    expect(path.heading).toBeCloseTo(90)
    imu.stop()
    imu.stop()
    expect(sensor.removeMotion).toHaveBeenCalledTimes(1)
    expect(sensor.removeHeading).toHaveBeenCalledTimes(1)
  })

  it('removes the motion listener if starting the compass fails', async () => {
    const sensor = mockSensors()
    sensor.sensors.Magnetometer.addListener.mockImplementation(() => { throw new Error('compass failed') })
    const detector = new StepDetector()
    const imu = createImuTracker(detector, () => {}, () => {})
    await expect(attachTrackerToImu(new PathTracker(), detector, imu)).rejects.toThrow('compass failed')
    expect(sensor.removeMotion).toHaveBeenCalledTimes(1)
    imu.stop()
    expect(sensor.removeMotion).toHaveBeenCalledTimes(1)
  })
})
