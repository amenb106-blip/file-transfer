import QRCode from 'qrcode'
import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  MAX_FILE_SIZE,
  completeTransfer,
  createTransfer,
  formatSize,
  uploadToStorage,
} from '../api'
import { CheckIcon, ClockIcon, CopyIcon, FileIcon, UploadIcon } from '../components/icons'

type Shared = {
  link: string
  qrCode: string | null
  expiresAt: string
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [passcode, setPasscode] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [shared, setShared] = useState<Shared | null>(null)
  const [copied, setCopied] = useState(false)
  const busy = progress !== null

  function copyLink(link: string) {
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setError('Could not copy the link. Select it and copy it yourself.'),
    )
  }

  function sendAnother() {
    setFile(null)
    setShared(null)
    setCopied(false)
    setError('')
  }

  async function sendFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !passcode || busy) return
    setError('')
    setProgress(0)

    try {
      const transfer = await createTransfer(file, passcode)
      await uploadToStorage(transfer.upload, file, setProgress)
      const completed = await completeTransfer(transfer.id, passcode)
      const link = `${window.location.origin}/d/${completed.share_token}`
      const qrCode = await QRCode.toDataURL(link, { width: 416, margin: 1 }).catch(() => null)
      setShared({ link, qrCode, expiresAt: completed.expires_at })
      setPasscode('')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send the file.')
    } finally {
      setProgress(null)
    }
  }

  if (shared) {
    return (
      <main className="content">
        <section className="card result" aria-live="polite">
          {shared.qrCode && (
            <div className="qr">
              <img src={shared.qrCode} width={208} height={208} alt="QR code for the share link" />
            </div>
          )}
          <div className="result-details">
            <div className="stack-sm">
              <span className="badge">
                <CheckIcon size={16} />
                Uploaded
              </span>
              <h1>Ready to share</h1>
              <p className="muted">Scan the QR code or open the link on your other device.</p>
            </div>

            <div className="field">
              <label htmlFor="share-link" className="field-label">Share link</label>
              <input
                id="share-link"
                className="input mono"
                readOnly
                value={shared.link}
                onFocus={(event) => event.target.select()}
              />
            </div>

            <div className="actions">
              <button type="button" className="button primary" onClick={() => copyLink(shared.link)}>
                <CopyIcon />
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" className="button secondary" onClick={sendAnother}>
                Send another file
              </button>
            </div>

            <p className="expires">
              <ClockIcon size={16} />
              Expires at {formatTime(shared.expiresAt)}
            </p>
            {error && <p role="alert" className="error">{error}</p>}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="content">
      <form className="card stack" onSubmit={sendFile}>
        <div className="stack-sm">
          <h1>Send a file</h1>
          <p className="muted">
            Open it on any device with a link or QR code. Links expire after 10 minutes.
          </p>
        </div>

        <div className="field">
          <span className="field-label">File</span>
          <input
            id="file"
            type="file"
            className="visually-hidden file-input"
            disabled={busy}
            onChange={(event) => {
              const selectedFile = event.target.files?.[0] ?? null

              setError('')
              setFile(null)

              if (selectedFile && (selectedFile.size === 0 || selectedFile.size > MAX_FILE_SIZE)) {
                setError('Choose a nonempty file no larger than 25 MB.')
                event.target.value = ''
                return
              }

              setFile(selectedFile)
            }}
          />
          {file ? (
            <label htmlFor="file" className="file-box chosen">
              <span className="file-icon"><FileIcon size={22} /></span>
              <span className="file-text">
                <span className="file-name">{file.name}</span>
                <span className="muted small">{formatSize(file.size)}</span>
              </span>
              {!busy && <span className="file-change">Change</span>}
            </label>
          ) : (
            <label htmlFor="file" className="file-box empty">
              <span className="upload-circle"><UploadIcon size={22} /></span>
              <span className="file-choose">Choose a file</span>
              <span className="muted small">Up to 25 MB</span>
            </label>
          )}
        </div>

        {progress !== null && (
          <div className="progress">
            <div className="progress-label">
              <span>Uploading…</span>
              <span className="mono">{Math.round(progress * 100)}%</span>
            </div>
            <progress value={progress} max={1} aria-label="Upload progress" />
          </div>
        )}

        <div className="field">
          <label htmlFor="passcode" className="field-label">Upload passcode</label>
          <input
            id="passcode"
            type="password"
            className="input"
            autoComplete="current-password"
            spellCheck={false}
            value={passcode}
            disabled={busy}
            onChange={(event) => setPasscode(event.target.value)}
            required
          />
        </div>

        <button type="submit" className="button primary wide" disabled={!file || !passcode || busy}>
          <UploadIcon />
          {busy ? 'Sending…' : 'Send file'}
        </button>

        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </main>
  )
}

export default UploadPage
