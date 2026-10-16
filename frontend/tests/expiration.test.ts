import assert from 'node:assert/strict'
import { test } from 'node:test'
import { minutesLeft, watchExpiration } from '../src/expiration.ts'

test('countdown updates across minute boundaries and stops exactly at expiry', (t) => {
  const windowTarget = new EventTarget()
  const documentTarget = new EventTarget()
  Object.defineProperty(globalThis, 'window', { value: windowTarget, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: documentTarget, configurable: true })
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const expiry = new Date(61_500).toISOString()
  const ticks: number[] = []
  const stop = watchExpiration(expiry, (now) => ticks.push(now))
  t.after(() => {
    stop()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
  })
  assert.equal(minutesLeft(expiry, ticks.at(-1)!), '2 minutes')
  t.mock.timers.tick(2000)
  assert.equal(minutesLeft(expiry, ticks.at(-1)!), '1 minute')
  t.mock.timers.tick(59_000)
  assert.ok(ticks.at(-1)! < Date.parse(expiry))
  t.mock.timers.tick(500)
  assert.equal(ticks.at(-1), Date.parse(expiry))
  assert.equal(minutesLeft(expiry, ticks.at(-1)!), '0 minutes')
  const count = ticks.length
  t.mock.timers.tick(5000)
  assert.equal(ticks.length, count)
})

test('returning from a suspended tab immediately catches up and cleanup removes listeners', (t) => {
  const windowTarget = new EventTarget()
  const documentTarget = new EventTarget()
  Object.defineProperty(globalThis, 'window', { value: windowTarget, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: documentTarget, configurable: true })
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const ticks: number[] = []
  const stop = watchExpiration(new Date(60_000).toISOString(), (now) => ticks.push(now))
  t.after(() => {
    stop()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
  })
  t.mock.timers.setTime(30_000)
  windowTarget.dispatchEvent(new Event('focus'))
  assert.equal(ticks.at(-1), 30_000)
  t.mock.timers.setTime(70_000)
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  assert.equal(ticks.at(-1), 70_000)
  stop()
  const count = ticks.length
  windowTarget.dispatchEvent(new Event('focus'))
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(5000)
  assert.equal(ticks.length, count)
})
