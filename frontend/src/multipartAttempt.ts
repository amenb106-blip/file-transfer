import { ApiError, cancelMultipartTransfer, completeMultipartTransfer, createMultipartTransfer, getPartUrl, uploadPart } from './api.ts'
import type { MultipartTransfer, UploadedPart } from './api.ts'
import { clearSavedUpload, saveUpload } from './savedUpload.ts'

const defaultOperations = { cancelMultipartTransfer, completeMultipartTransfer, createMultipartTransfer, getPartUrl, uploadPart }
const MAX_PART_RETRIES = 3

export type UploadRetry = { part: number; attempt: number; maxRetries: number; delayMs: number }

function retryable(error: unknown, uploading: boolean) {
  if (!(error instanceof ApiError)) return false
  return [0, 408, 429, 500, 502, 503, 504].includes(error.status)
    // S3 uses 403 for expired signatures. Obtain a fresh URL before retrying;
    // an API authorization error must still stop immediately.
    || (uploading && error.status === 403)
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', abort, { once: true })
  })
}

// Keep confirmed parts and the completion token across retries in this tab.
// Save checkpoints for the next stage: validating and restoring after a refresh.
export function createMultipartAttempt(file: File, operations = defaultOperations, recipientId?: string) {
  let transfer: MultipartTransfer | null = null
  let parts: UploadedPart[] = []
  let token = ''
  let controller = new AbortController()
  let active: Promise<unknown> | null = null
  let canceling = false
  let canceled = false
  let finishing = false

  async function run(passcode: string, progress: (fraction: number) => void, onRetry: (retry: UploadRetry | null) => void) {
    if (transfer && Date.parse(transfer.expires_at) <= Date.now()) {
      clearSavedUpload(transfer.id)
      transfer = null
      parts = []
    }
    if (!transfer) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
      // Do not abort creation: retain its ID so cancellation can clean it up.
      transfer = await operations.createMultipartTransfer(file, passcode, recipientId)
      saveUpload(file, transfer, parts, token)
    }
    controller.signal.throwIfAborted()
    const count = Math.ceil(file.size / transfer.part_size)
    for (let number = parts.length + 1; number <= count; number++) {
      const offset = (number - 1) * transfer.part_size
      progress(offset / file.size)
      const body = file.slice(offset, Math.min(offset + transfer.part_size, file.size))
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted()
        if (Date.parse(transfer.expires_at) <= Date.now()) {
          throw new ApiError(410, 'This upload has expired. Send the file again to start a new transfer.')
        }
        let uploading = false
        try {
          const { url } = await operations.getPartUrl(transfer.id, number, passcode, controller.signal)
          controller.signal.throwIfAborted()
          uploading = true
          const etag = await operations.uploadPart(url, body,
            bytes => progress(Math.min((offset + bytes) / file.size, 1)), controller.signal)
          parts.push({ number, etag })
          saveUpload(file, transfer, parts, token)
          break
        } catch (error) {
          controller.signal.throwIfAborted()
          if (attempt >= MAX_PART_RETRIES || !retryable(error, uploading)) throw error
          // Only confirmed parts count while waiting. Reuse this part number so
          // a lost PUT response cannot append a duplicate part to the upload.
          progress(offset / file.size)
          const delayMs = 1000 * 2 ** attempt + Math.floor(Math.random() * 250)
          onRetry({ part: number, attempt: attempt + 1, maxRetries: MAX_PART_RETRIES, delayMs })
          await waitForRetry(delayMs, controller.signal)
          onRetry(null)
        }
      }
      controller.signal.throwIfAborted()
    }
    // Cancellation is unavailable once finalization begins; a lost response can
    // be recovered using the same token and part manifest on the next send.
    finishing = true
    progress(1)
    const completed = await operations.completeMultipartTransfer(transfer.id, passcode, token, parts)
    clearSavedUpload(transfer.id)
    return completed
  }

  return {
    get uploaded() { return !!transfer && parts.length === Math.ceil(file.size / transfer.part_size) },
    get finishing() { return finishing },
    async send(passcode: string, progress: (fraction: number) => void,
      onRetry: (retry: UploadRetry | null) => void = () => {}) {
      if (active || canceling || canceled) throw new Error('This upload is stopped or already running.')
      controller = new AbortController()
      finishing = false
      const task = run(passcode, progress, onRetry)
      active = task
      try { return await task }
      catch (error) {
        if (error instanceof ApiError && error.status === 410) {
          if (transfer) clearSavedUpload(transfer.id)
          transfer = null
          parts = []
        }
        throw error
      }
      finally { active = null; finishing = false; onRetry(null) }
    },
    async cancel(passcode: string) {
      if (finishing) throw new Error('The file is being finalized. Wait for sharing to finish.')
      canceling = true
      controller.abort()
      try {
        await active?.catch(() => {})
        if (transfer) {
          await operations.cancelMultipartTransfer(transfer.id, passcode)
          clearSavedUpload(transfer.id)
        }
        canceled = true
      } finally { canceling = false }
    },
  }
}
