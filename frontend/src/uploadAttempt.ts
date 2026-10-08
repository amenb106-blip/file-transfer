import { completeTransfer, createTransfer, uploadToStorage } from './api.ts'
import type { CreatedTransfer } from './api.ts'

const defaultOperations = { createTransfer, completeTransfer, uploadToStorage }

export function createUploadAttempt(file: File, operations = defaultOperations) {
  let transfer: CreatedTransfer | null = null
  let uploaded = false
  let shareToken = ''

  return {
    get uploaded() { return uploaded },
    async send(passcode: string, onProgress: (fraction: number) => void) {
      if (transfer && Date.parse(transfer.expires_at) <= Date.now()) {
        transfer = null
        uploaded = false
      }
      if (!transfer) {
        shareToken = Array.from(crypto.getRandomValues(new Uint8Array(32)),
          (byte) => byte.toString(16).padStart(2, '0')).join('')
        transfer = await operations.createTransfer(file, passcode)
      }
      if (!uploaded) {
        await operations.uploadToStorage(transfer.upload, file, onProgress)
        uploaded = true
      }
      onProgress(1)
      return operations.completeTransfer(transfer.id, passcode, shareToken)
    },
  }
}
