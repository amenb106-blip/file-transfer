import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUploadAttempt } from '../src/uploadAttempt.ts'
import { ApiError, completeTransfer } from '../src/api.ts'

function fixture() {
  const calls = { creates: 0, uploads: 0, completions: [] as string[] }
  const file = new File(['hello'], 'notes.txt')
  const operations = {
    async createTransfer() {
      calls.creates++
      return {
        id: `transfer-${calls.creates}`, filename: file.name, size_bytes: file.size,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        upload: { url: 'https://storage.invalid', fields: {} },
      }
    },
    async uploadToStorage() { calls.uploads++ },
    async completeTransfer(_id: string, _passcode: string, token: string) {
      calls.completions.push(token)
      if (calls.completions.length === 1) throw new ApiError(0, 'Response lost')
      return { share_token: token, expires_at: new Date(Date.now() + 600_000).toISOString() }
    },
  }
  return { calls, file, operations }
}

test('a lost completion response retries the same token without uploading again', async () => {
  const { calls, file, operations } = fixture()
  const attempt = createUploadAttempt(file, operations)
  await assert.rejects(attempt.send('passcode', () => {}), /Response lost/)
  assert.equal(attempt.uploaded, true)
  const result = await attempt.send('corrected-passcode', () => {})
  assert.equal(calls.creates, 1)
  assert.equal(calls.uploads, 1)
  assert.match(result.share_token, /^[0-9a-f]{64}$/)
  assert.deepEqual(calls.completions, [result.share_token, result.share_token])
})

test('an upload failure retries storage before completing', async () => {
  const { calls, file, operations } = fixture()
  operations.uploadToStorage = async () => {
    calls.uploads++
    if (calls.uploads === 1) throw new Error('Upload interrupted')
  }
  const attempt = createUploadAttempt(file, operations)
  await assert.rejects(attempt.send('passcode', () => {}), /Upload interrupted/)
  assert.equal(attempt.uploaded, false)
  assert.equal(calls.completions.length, 0)
  await assert.rejects(attempt.send('passcode', () => {}), /Response lost/)
  await attempt.send('passcode', () => {})
  assert.equal(calls.creates, 1)
  assert.equal(calls.uploads, 2)
})

test('an expired attempt creates a new transfer and a new token', async (t) => {
  const { calls, file, operations } = fixture()
  const attempt = createUploadAttempt(file, operations)
  await assert.rejects(attempt.send('passcode', () => {}), /Response lost/)
  const future = Date.now() + 601_000
  t.mock.method(Date, 'now', () => future)
  await attempt.send('passcode', () => {})
  assert.equal(calls.creates, 2)
  assert.equal(calls.uploads, 2)
  assert.notEqual(calls.completions[0], calls.completions[1])
})

test('a different selected file uses a separate transfer', async () => {
  const { calls, file, operations } = fixture()
  await assert.rejects(createUploadAttempt(file, operations).send('passcode', () => {}))
  await createUploadAttempt(new File(['next'], 'next.txt'), operations).send('passcode', () => {})
  assert.equal(calls.creates, 2)
  assert.equal(calls.uploads, 2)
  assert.notEqual(calls.completions[0], calls.completions[1])
})

test('completion sends the retained token and passcode to the API', async (t) => {
  const token = 'ab'.repeat(32)
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/transfers/transfer-id/complete')
    assert.equal(init.method, 'POST')
    assert.equal(new Headers(init.headers).get('X-Upload-Passcode'), 'passcode')
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json')
    assert.deepEqual(JSON.parse(init.body as string), { share_token: token })
    return Response.json({ share_token: token, expires_at: '2026-10-07T20:00:00Z' })
  })
  assert.equal((await completeTransfer('transfer-id', 'passcode', token)).share_token, token)
})
