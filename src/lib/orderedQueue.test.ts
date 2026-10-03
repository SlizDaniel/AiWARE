import { expect, test } from 'vitest'
import { createOrderedQueue } from './orderedQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('results are delivered in the order tasks were pushed, even if they finish out of order', async () => {
  const queue = createOrderedQueue<string>()
  const delivered: string[] = []
  const first = deferred<string>()
  const second = deferred<string>()
  const third = deferred<string>()
  queue.push(first.promise, (value) => delivered.push(value))
  queue.push(second.promise, (value) => delivered.push(value))
  const last = queue.push(third.promise, (value) => delivered.push(value))
  third.resolve('trzecia')
  second.resolve('druga')
  await Promise.resolve()
  expect(delivered).toEqual([])
  first.resolve('pierwsza')
  await last
  expect(delivered).toEqual(['pierwsza', 'druga', 'trzecia'])
})

test('a failed task does not block the following ones', async () => {
  const queue = createOrderedQueue<number>()
  const delivered: number[] = []
  queue.push(Promise.reject(new Error('STT 429')), (value) => delivered.push(value))
  const last = queue.push(Promise.resolve(2), (value) => delivered.push(value))
  await last
  expect(delivered).toEqual([2])
})

test('cancel drops pending results; later pushes are delivered again', async () => {
  const queue = createOrderedQueue<string>()
  const delivered: string[] = []
  const pending = deferred<string>()
  const dropped = queue.push(pending.promise, (value) => delivered.push(value))
  queue.cancel()
  pending.resolve('stara sesja')
  await dropped
  await queue.push(Promise.resolve('nowa sesja'), (value) => delivered.push(value))
  expect(delivered).toEqual(['nowa sesja'])
})

test('after cancel new tasks do not wait for a hung task from the old session', async () => {
  const queue = createOrderedQueue<string>()
  const delivered: string[] = []
  queue.push(new Promise<string>(() => {}), (value) => delivered.push(value))
  queue.cancel()
  await queue.push(Promise.resolve('po anulowaniu'), (value) => delivered.push(value))
  expect(delivered).toEqual(['po anulowaniu'])
})
