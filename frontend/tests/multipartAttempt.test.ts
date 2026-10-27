import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMultipartAttempt } from '../src/multipartAttempt.ts'
import type { UploadedPart } from '../src/api.ts'
import { ApiError } from '../src/api.ts'

function fixture() {
  const file = new File(['abcdefghij'], 'example.txt')
  const calls = { creates: 0, signed: [] as number[], bodies: [] as string[], completed: [] as string[], cancels: 0 }
  const operations = {
    async createMultipartTransfer() {
      calls.creates++
      return { id: 'transfer', filename: file.name, size_bytes: file.size, part_size: 4,
        expires_at: new Date(Date.now() + 3600_000).toISOString() }
    },
    async getPartUrl(_id: string, number: number) { calls.signed.push(number); return { url: `part-${number}` } },
    async uploadPart(url: string, body: Blob, progress: (bytes: number) => void, signal: AbortSignal) {
      signal.throwIfAborted()
      calls.bodies.push(await body.text())
      progress(body.size)
      return `etag-${url}`
    },
    async completeMultipartTransfer(_id: string, _passcode: string, token: string, parts: UploadedPart[]) {
      assert.deepEqual(parts.map(p => p.number), [1, 2, 3])
      calls.completed.push(token)
      return { share_token: token, expires_at: new Date(Date.now() + 600_000).toISOString() }
    },
    async cancelMultipartTransfer() { calls.cancels++; return { status: 'canceled' } },
  }
  return { file, calls, operations }
}

test('splits a file, including its short last part, and reports total progress', async () => {
  const { file, calls, operations } = fixture()
  const progress: number[] = []
  await createMultipartAttempt(file, operations).send('secret', p => progress.push(p))
  assert.deepEqual(calls.bodies, ['abcd', 'efgh', 'ij'])
  assert.deepEqual(calls.signed, [1, 2, 3])
  assert.equal(progress.at(-1), 1)
  assert.ok(progress.includes(0.4) && progress.includes(0.8))
})

test('retry signs a new URL for the failed part and skips confirmed parts', async () => {
  const { file, calls, operations } = fixture()
  const upload = operations.uploadPart
  let fail = true
  operations.uploadPart = async (...args) => {
    if (args[0] === 'part-2' && fail) { fail = false; throw new Error('Disconnected') }
    return upload(...args)
  }
  const attempt = createMultipartAttempt(file, operations)
  await assert.rejects(attempt.send('secret', () => {}), /Disconnected/)
  await attempt.send('secret', () => {})
  assert.deepEqual(calls.signed, [1, 2, 2, 3])
  assert.deepEqual(calls.bodies, ['abcd', 'efgh', 'ij'])
  assert.equal(calls.creates, 1)
})

test('lost completion response retries the same manifest and token without uploading', async () => {
  const { file, calls, operations } = fixture()
  const complete = operations.completeMultipartTransfer
  operations.completeMultipartTransfer = async (...args) => {
    const result = await complete(...args)
    if (calls.completed.length === 1) throw new Error('Response lost')
    return result
  }
  const attempt = createMultipartAttempt(file, operations)
  await assert.rejects(attempt.send('secret', () => {}), /Response lost/)
  assert.equal(attempt.uploaded, true)
  await attempt.send('secret', () => {})
  assert.equal(calls.completed[0], calls.completed[1])
  assert.equal(calls.bodies.length, 3)
})

test('cancellation aborts the in-flight chunk before cleaning up and never completes', async () => {
  const { file, calls, operations } = fixture()
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  operations.uploadPart = async (_url, _body, _progress, signal) => {
    started()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }
  const attempt = createMultipartAttempt(file, operations)
  const sending = attempt.send('secret', () => {})
  const rejected = assert.rejects(sending, { name: 'AbortError' })
  await ready
  await attempt.cancel('secret')
  await rejected
  assert.equal(calls.cancels, 1)
  assert.deepEqual(calls.completed, [])
  await assert.rejects(attempt.send('secret', () => {}), /stopped/)
})

test('cancel during creation waits for the transfer ID then cleans it up', async () => {
  const { file, calls, operations } = fixture()
  const create = operations.createMultipartTransfer
  let release!: () => void
  operations.createMultipartTransfer = async () => {
    await new Promise<void>(resolve => { release = resolve })
    return create()
  }
  const attempt = createMultipartAttempt(file, operations)
  const rejected = assert.rejects(attempt.send('secret', () => {}), { name: 'AbortError' })
  const cancel = attempt.cancel('secret')
  release()
  await cancel
  await rejected
  assert.equal(calls.cancels, 1)
  assert.deepEqual(calls.signed, [])
})

test('failed cancellation can be retried', async () => {
  const { file, calls, operations } = fixture()
  operations.uploadPart = async () => { throw new Error('Disconnected') }
  operations.cancelMultipartTransfer = async () => {
    if (++calls.cancels === 1) throw new Error('Offline')
    return { status: 'canceled' }
  }
  const attempt = createMultipartAttempt(file, operations)
  await assert.rejects(attempt.send('secret', () => {}))
  await assert.rejects(attempt.cancel('secret'), /Offline/)
  await attempt.cancel('secret')
  assert.equal(calls.cancels, 2)
})

test('server expiry discards stale parts so the next retry starts a new upload', async () => {
  const { file, calls, operations } = fixture()
  const getUrl = operations.getPartUrl
  let fail = true
  operations.getPartUrl = async (...args) => {
    if (args[1] === 2 && fail) { fail = false; throw new ApiError(410, 'Expired') }
    return getUrl(...args)
  }
  const attempt = createMultipartAttempt(file, operations)
  await assert.rejects(attempt.send('secret', () => {}), /Expired/)
  await attempt.send('secret', () => {})
  assert.equal(calls.creates, 2)
  assert.deepEqual(calls.bodies, ['abcd', 'abcd', 'efgh', 'ij'])
})

test('cancellation and duplicate sends cannot race with completion', async () => {
  const { file, calls, operations } = fixture()
  const complete = operations.completeMultipartTransfer
  let started!: () => void
  let release!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  operations.completeMultipartTransfer = async (...args) => {
    started()
    await new Promise<void>(resolve => { release = resolve })
    return complete(...args)
  }
  const attempt = createMultipartAttempt(file, operations)
  const sending = attempt.send('secret', () => {})
  await ready
  await assert.rejects(attempt.cancel('secret'), /finalized/)
  await assert.rejects(attempt.send('secret', () => {}), /already running/)
  release()
  await sending
  assert.equal(calls.cancels, 0)
})
