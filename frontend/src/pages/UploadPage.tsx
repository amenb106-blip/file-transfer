import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  MAX_FILE_SIZE,
  checkHealth,
  completeTransfer,
  createTransfer,
  formatSize,
  uploadToStorage,
} from '../api'

type Shared = {
  link: string
  qrCode: string | null
  expiresAt: string
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [apiStatus, setApiStatus] = useState('Connecting...')
  const [passcode, setPasscode] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [shared, setShared] = useState<Shared | null>(null)
  const busy = progress !== null

  useEffect(() => {
    const controller = new AbortController()
    checkHealth(controller.signal)
      .then((data) => setApiStatus(data.status === 'ok' ? 'Connected' : 'Unexpected response'))
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus('Backend unavailable')
      })
    return () => controller.abort()
  }, [])

  async function sendFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !passcode || busy || shared) return
    setError('')
    setProgress(0)

    try {
      const transfer = await createTransfer(file, passcode)
      await uploadToStorage(transfer.upload, file, setProgress)
      const completed = await completeTransfer(transfer.id, passcode)
      const link = `${window.location.origin}/d/${completed.share_token}`
      // The link still works if the QR code can't be drawn, so don't fail the transfer over it.
      const qrCode = await QRCode.toDataURL(link, { width: 240, margin: 1 }).catch(() => null)
      setShared({ link, qrCode, expiresAt: completed.expires_at })
      setPasscode('')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send the file.')
    } finally {
      setProgress(null)
    }
  }

  return (
    <main>
      <h1>File Transfer</h1>
      <p>Backend: {apiStatus}</p>
      <p>Choose a file to send to another device.</p>

      <form onSubmit={sendFile}>
        <label htmlFor="file">Choose a file</label>
        <input
          id="file"
          type="file"
          disabled={busy}
          onChange={(event) => {
            const selectedFile = event.target.files?.[0] ?? null

            setError('')
            setFile(null)
            setShared(null)

            if (selectedFile && (selectedFile.size === 0 || selectedFile.size > MAX_FILE_SIZE)) {
              setError('Choose a nonempty file no larger than 25 MB.')
              event.target.value = ''
              return
            }

            setFile(selectedFile)
          }}
        />

        {file && (
          <p>
            {file.name} — {formatSize(file.size)}
          </p>
        )}

        <label htmlFor="passcode">Upload passcode</label>
        <input
          id="passcode"
          type="password"
          autoComplete="off"
          value={passcode}
          disabled={busy}
          onChange={(event) => setPasscode(event.target.value)}
          required
        />
        <button type="submit" disabled={!file || !passcode || busy || Boolean(shared)}>
          {busy ? 'Sending...' : 'Send file'}
        </button>
      </form>

      {progress !== null && (
        <p>
          <progress value={progress} max={1} /> {Math.round(progress * 100)}%
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {shared && (
        <section aria-live="polite">
          <h2>Ready to share</h2>
          <p>Scan the QR code or open the link on your other device:</p>
          {shared.qrCode && (
            <img src={shared.qrCode} width={240} height={240} alt="QR code for the share link" />
          )}
          <p>
            <a href={shared.link}>{shared.link}</a>
          </p>
          <p>Expires: {new Date(shared.expiresAt).toLocaleString()}</p>
        </section>
      )}
    </main>
  )
}

export default UploadPage
