import type { MultipartTransfer, UploadedPart } from './api.ts'

// sessionStorage survives refreshes and keeps different tabs' uploads separate.
const STORAGE_KEY = 'file-transfer:unfinished-upload:v1'

export function saveUpload(file: File, transfer: MultipartTransfer, parts: UploadedPart[], shareToken: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      file: { name: file.name, size: file.size, lastModified: file.lastModified },
      transfer: {
        id: transfer.id, filename: transfer.filename, size_bytes: transfer.size_bytes,
        expires_at: transfer.expires_at, part_size: transfer.part_size,
      },
      parts: parts.map(({ number, etag }) => ({ number, etag })),
      shareToken,
    }))
  } catch {
    // Disabled/full browser storage must not interrupt an otherwise valid upload.
    // Only metadata is saved here, never file contents or the upload passcode.
  }
}

export function clearSavedUpload(transferId: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (saved?.transfer?.id === transferId) sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Upload completion/cancellation still succeeds when storage is unavailable.
  }
}
