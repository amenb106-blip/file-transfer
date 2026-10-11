import QRCode from 'qrcode'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { MAX_FILE_SIZE } from '../api'
import { createUploadAttempt } from '../uploadAttempt'
import FileSummary from '../components/FileSummary'
import TransferLayout from '../components/TransferLayout'
import { ArrowRightIcon, CheckIcon, ClockIcon, CopyIcon, KeyIcon, UploadIcon } from '../components/icons'

type Shared = { link: string; qrCode: string | null; expiresAt: string }
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
  const [dragging, setDragging] = useState(false)
  const attempt = useRef<ReturnType<typeof createUploadAttempt> | null>(null)
  const [retryCompletion, setRetryCompletion] = useState(false)
  const busy = progress !== null

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setError('')
    } catch {
      setError('Could not copy the link. Select it and copy it yourself.')
    }
  }

  function selectFiles(files: FileList | null) {
    if (busy || !files?.length) return
    setError('')
    setFile(null)
    attempt.current = null
    setRetryCompletion(false)
    if (files.length !== 1) {
      setError('Choose one file at a time.')
      return
    }
    const selected = files[0]
    if (selected.size === 0 || selected.size > MAX_FILE_SIZE) {
      setError('Choose a nonempty file no larger than 25 MB.')
      return
    }
    setFile(selected)
  }

  function sendAnother() {
    attempt.current = null
    setRetryCompletion(false)
    setFile(null)
    setShared(null)
    setCopied(false)
    setError('')
  }

  async function sendFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !passcode || busy) return
    setError('')
    setDragging(false)
    setProgress(0)
    try {
      attempt.current ??= createUploadAttempt(file)
      const completed = await attempt.current.send(passcode, setProgress)
      const link = `${window.location.origin}/d/${completed.share_token}`
      const qrCode = await QRCode.toDataURL(link, { width: 416, margin: 4 }).catch(() => null)
      setShared({ link, qrCode, expiresAt: completed.expires_at })
      setPasscode('')
    } catch (error) {
      setRetryCompletion(attempt.current?.uploaded ?? false)
      setError(error instanceof Error ? error.message : 'Could not send the file.')
    } finally {
      setProgress(null)
    }
  }

  if (shared) {
    return (
      <TransferLayout title="Ready to share" step={2}>
        {file && <div className="file-box chosen"><FileSummary name={file.name} size={file.size} /></div>}
        <div className={`share-grid${shared.qrCode ? '' : ' without-qr'}`}>
          {shared.qrCode && <figure className="qr">
            <img src={shared.qrCode} width={144} height={144} alt="QR code for the share link" />
            <figcaption>Scan to open</figcaption>
          </figure>}
          <div className="share-details">
            <div className="field">
              <label htmlFor="share-link" className="field-label">Share link</label>
              <input id="share-link" className="input mono" readOnly value={shared.link}
                onFocus={(event) => event.target.select()} />
            </div>
            <div className="actions">
              <button type="button" className="button primary" onClick={() => copyLink(shared.link)} aria-live="polite">
                {copied ? <CheckIcon size={17} /> : <CopyIcon size={17} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" className="button secondary" onClick={sendAnother}>Send another file</button>
            </div>
            <p className="expires"><ClockIcon size={14} />Expires at {formatTime(shared.expiresAt)}</p>
            {error && <p role="alert" className="error">{error}</p>}
          </div>
        </div>
      </TransferLayout>
    )
  }

  return (
    <TransferLayout title={busy ? progress === 1 ? 'Finishing transfer' : 'Uploading file' : 'New transfer'} step={file ? 1 : 0}>
      <form className="upload-form" onSubmit={sendFile} aria-busy={busy}>
        <div className={`field file-picker${dragging ? ' is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
            if (!busy && event.dataTransfer.types.includes('Files')) setDragging(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            selectFiles(event.dataTransfer.files)
          }}>
          <div className="field-heading"><span className="field-label">File</span><span id="file-limit" className="muted small">25 MB max</span></div>
          <input id="file" type="file" className="visually-hidden file-input" disabled={busy}
            aria-label={file ? 'Change file' : 'Choose a file'} aria-describedby="file-limit"
            onChange={(event) => { selectFiles(event.target.files); event.target.value = '' }} />
          {file ? <label htmlFor="file" className="file-box chosen selectable">
            <FileSummary name={file.name} size={file.size} />
            {!busy && <span className="file-change">Change</span>}
          </label> : <label htmlFor="file" className="file-box empty selectable">
            <span className="upload-symbol"><UploadIcon size={21} /></span>
            <span className="file-choose">Choose a file</span><span className="muted small">or drop it here</span>
          </label>}
        </div>
        {progress !== null ? <div className="progress">
          <div className="progress-label"><span>{progress === 1 ? 'Preparing share link…' : 'Uploading…'}</span><span className="mono">{Math.round(progress * 100)}%</span></div>
          <progress value={progress} max={1} aria-label="Upload progress" />
        </div> : <div className="field">
          <label htmlFor="passcode" className="field-label">Upload passcode</label>
          <div className="input-wrap"><KeyIcon size={17} />
            <input id="passcode" type="password" autoComplete="current-password" spellCheck={false}
              value={passcode} onChange={(event) => setPasscode(event.target.value)} required />
          </div>
        </div>}
        <div className="send-actions">
          <p className="expires"><ClockIcon size={14} />Links expire after 10 minutes.</p>
          <button type="submit" className="button primary" disabled={!file || !passcode || busy}>
            {busy ? 'Sending…' : retryCompletion ? 'Retry sharing' : 'Send file'}<ArrowRightIcon size={17} />
          </button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </TransferLayout>
  )
}

export default UploadPage
