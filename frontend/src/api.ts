export const MAX_FILE_SIZE = 512 * 1024 * 1024

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
    init?.signal?.throwIfAborted()
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

export function completeTransfer(id: string, passcode: string, shareToken: string) {
  return request<CompletedTransfer>(`/api/transfers/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Passcode': passcode },
    body: JSON.stringify({ share_token: shareToken }),
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

export type MultipartTransfer = Omit<CreatedTransfer, 'upload'> & { part_size: number }
export type UploadedPart = { number: number; etag: string }

export function createMultipartTransfer(file: File, passcode: string) {
  return request<MultipartTransfer>('/api/multipart-transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Passcode': passcode },
    body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
  })
}

export function getPartUrl(id: string, number: number, passcode: string, signal?: AbortSignal) {
  return request<{ url: string }>(`/api/multipart-transfers/${encodeURIComponent(id)}/parts/${number}`, {
    method: 'POST', headers: { 'X-Upload-Passcode': passcode }, signal,
  })
}

export function completeMultipartTransfer(id: string, passcode: string, shareToken: string, parts: UploadedPart[]) {
  return request<CompletedTransfer>(`/api/multipart-transfers/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Passcode': passcode },
    body: JSON.stringify({ share_token: shareToken, parts }),
  })
}

export function cancelMultipartTransfer(id: string, passcode: string) {
  return request<{ status: string }>(`/api/multipart-transfers/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'X-Upload-Passcode': passcode },
  })
}

export function uploadPart(url: string, body: Blob, onProgress: (bytes: number) => void, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    signal.throwIfAborted()
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = (error?: Error, etag?: string) => {
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(etag!)
    }
    xhr.open('PUT', url)
    xhr.timeout = 120_000
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded) }
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag')
      if (xhr.status >= 200 && xhr.status < 300 && etag) finish(undefined, etag)
      else finish(new ApiError(xhr.status, xhr.status >= 200 && xhr.status < 300
        ? 'Could not confirm the uploaded part. Retry the upload or contact the site owner.'
        : 'The upload was rejected. Retry the upload.'))
    }
    xhr.onerror = () => finish(new ApiError(0, 'Upload interrupted. Retry to continue from completed parts.'))
    xhr.ontimeout = () => finish(new ApiError(0, 'Upload timed out. Retry to continue from completed parts.'))
    xhr.onabort = () => finish(new DOMException('Upload stopped.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}
