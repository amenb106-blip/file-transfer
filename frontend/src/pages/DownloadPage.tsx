import { useEffect, useState } from 'react'
import { ApiError, formatSize, getDownloadUrl, getSharedFile } from '../api'
import type { SharedFile } from '../api'

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return 'This link is invalid. Check that you copied all of it.'
  if (error instanceof ApiError && error.status === 410) return 'This link has expired. Ask the sender for a new one.'
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}

function DownloadPage({ token }: { token: string }) {
  const [file, setFile] = useState<SharedFile | null>(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getSharedFile(token, controller.signal)
      .then(setFile)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
    return () => controller.abort()
  }, [token])

  async function download() {
    setError('')
    setDownloading(true)
    try {
      const { url } = await getDownloadUrl(token)
      window.location.assign(url)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main>
      <h1>File Transfer</h1>
      {!file && !error && <p>Loading...</p>}
      {file && (
        <section>
          <h2>{file.filename}</h2>
          <p>{formatSize(file.size_bytes)}</p>
          <p>Expires: {new Date(file.expires_at).toLocaleString()}</p>
          <button type="button" onClick={download} disabled={downloading}>
            {downloading ? 'Starting download...' : 'Download'}
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

export default DownloadPage
