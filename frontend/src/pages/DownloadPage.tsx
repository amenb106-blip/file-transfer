import { useEffect, useState } from 'react'
import { ApiError, getDownloadUrl, getSharedFile } from '../api'
import type { SharedFile } from '../api'
import FileSummary from '../components/FileSummary'
import TransferLayout from '../components/TransferLayout'
import { ClockIcon, DownloadIcon, LinkIcon } from '../components/icons'

type Notice = {
  kind: 'expired' | 'invalid' | 'other'
  title: string
  detail: string
}

function describeProblem(error: unknown): Notice {
  if (error instanceof ApiError && error.status === 410) {
    return {
      kind: 'expired',
      title: 'This link has expired',
      detail: 'Links only work for 10 minutes. Ask the sender to send the file again.',
    }
  }
  if (error instanceof ApiError && error.status === 404) {
    return {
      kind: 'invalid',
      title: "This link doesn't work",
      detail: 'Check that you copied the whole link, or ask the sender for a new one.',
    }
  }
  return {
    kind: 'other',
    title: 'Something went wrong',
    detail: error instanceof Error ? error.message : 'Try again.',
  }
}

function minutesLeft(expiresAt: string) {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

function DownloadPage({ token }: { token: string }) {
  const [file, setFile] = useState<SharedFile | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getSharedFile(token, controller.signal)
      .then(setFile)
      .catch((error) => {
        if (!controller.signal.aborted) setNotice(describeProblem(error))
      })
    return () => controller.abort()
  }, [token])

  async function download() {
    setDownloadError('')
    setDownloading(true)
    try {
      const { url } = await getDownloadUrl(token)
      window.location.assign(url)
    } catch (error) {
      const problem = describeProblem(error)
      if (problem.kind === 'other') setDownloadError(problem.detail)
      else setNotice(problem)
    } finally {
      setDownloading(false)
    }
  }

  if (notice) {
    return (
      <TransferLayout title={notice.title}>
        <div className="notice" role="alert">
          <span className={`notice-icon ${notice.kind}`}>
            {notice.kind === 'invalid' ? <LinkIcon size={30} /> : <ClockIcon size={30} />}
          </span>
          <p className="muted">{notice.detail}</p>
        </div>
      </TransferLayout>
    )
  }

  if (!file) {
    return (
      <TransferLayout title="Download file">
        <p className="muted" role="status">Loading…</p>
      </TransferLayout>
    )
  }

  return (
    <TransferLayout title="Download file">
      <div className="download">
        <div className="file-box chosen">
          <FileSummary name={file.filename} size={file.size_bytes} />
        </div>
        <div className="send-actions">
          <p className="expires"><ClockIcon size={14} />Expires in {minutesLeft(file.expires_at)}</p>
          <button type="button" className="button primary" onClick={download} disabled={downloading}>
            <DownloadIcon size={17} />
            {downloading ? 'Starting download…' : 'Download file'}
          </button>
        </div>
        {downloadError && <p role="alert" className="error">{downloadError}</p>}
      </div>
    </TransferLayout>
  )
}

export default DownloadPage
