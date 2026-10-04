export const MAX_FILE_SIZE = 25 * 1024 * 1024

export type CreatedTransfer = {
  id: string
  filename: string
  size_bytes: number
  expires_at: string
  upload: { url: string; fields: Record<string, string> }
}

export type CompletedTransfer = {
  share_token: string
  expires_at: string
}

export type SharedFile = {
  filename: string
  size_bytes: number
  expires_at: string
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = typeof body?.detail === 'string'
      ? body.detail
      : response.status === 422
        ? 'The file name or size is not accepted. Choose another file.'
        : 'Something went wrong. Try again.'
    throw new ApiError(response.status, message)
  }
  return response.json()
}

export function createTransfer(file: File, passcode: string) {
  return request<CreatedTransfer>('/api/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Passcode': passcode },
    body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
  })
}

export function completeTransfer(id: string, passcode: string) {
  return request<CompletedTransfer>(`/api/transfers/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'X-Upload-Passcode': passcode },
  })
}

export function getSharedFile(token: string, signal?: AbortSignal) {
  return request<SharedFile>(`/api/share/${encodeURIComponent(token)}`, { signal })
}

export function getDownloadUrl(token: string) {
  return request<{ url: string }>(`/api/share/${encodeURIComponent(token)}/download`, {
    method: 'POST',
  })
}

export function uploadToStorage(
  upload: CreatedTransfer['upload'],
  file: File,
  onProgress: (fraction: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', upload.url)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new ApiError(xhr.status, 'The upload was rejected. Try again.'))
    }
    xhr.onerror = () => reject(new ApiError(0, 'The upload failed. Check your connection and try again.'))
    xhr.send(form)
  })
}

export function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
