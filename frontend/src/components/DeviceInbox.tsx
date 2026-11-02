import { useEffect, useState } from 'react'
import { ApiError } from '../api'
import { downloadInboxFile, getInbox, problemMessage } from '../deviceApi'
import type { InboxFile } from '../deviceApi'
import FileSummary from './FileSummary'
import { minutesLeft } from '../expiration'

export default function DeviceInbox({ deviceId, onCount }: { deviceId: string; onCount: (count: number) => void }) {
  const [files, setFiles] = useState<InboxFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const items = await getInbox(controller.signal)
        if (controller.signal.aborted) return
        setFiles(items); setError('')
      } catch (error) { if (!controller.signal.aborted) setError(problemMessage(error)) }
      finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(refresh, 8000) }
      }
    }
    void refresh()
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock) }
  }, [deviceId])

  async function download(file: InboxFile) {
    setDownloading(file.id); setDownloadError('')
    try { const { url } = await downloadInboxFile(file.id); window.location.assign(url) }
    catch (error) {
      setDownloadError(problemMessage(error))
      if (error instanceof ApiError && [404, 410].includes(error.status)) setFiles(items => items.filter(item => item.id !== file.id))
    } finally { setDownloading(null) }
  }

  const activeFiles = files.filter(file => Date.parse(file.expires_at) > now)
  useEffect(() => { onCount(activeFiles.length) }, [activeFiles.length, onCount])
  return <section className="field" aria-label="Incoming files">
    <h2 className="device-heading" aria-live="polite">Receive files <span className="muted small">({activeFiles.length})</span></h2>
    <p className="muted small">Files from your paired devices appear here automatically. Download within 10 minutes of upload.</p>
    {loading ? <p role="status">Loading inbox…</p> : !activeFiles.length && <p className="muted small">No incoming files yet.</p>}
    {activeFiles.map(file => <div className="inbox-item" key={file.id}>
      <div className="file-box chosen"><FileSummary name={file.filename} size={file.size_bytes} /></div>
      <div className="send-actions"><span className="muted small">From {file.sender_name} · {minutesLeft(file.expires_at, now)} left</span>
        <button className="button secondary" disabled={downloading !== null} onClick={() => download(file)}>{downloading === file.id ? 'Starting…' : 'Download'}</button>
      </div>
    </div>)}
    {(error || downloadError) && <p className="error" role="alert">{downloadError || error}</p>}
  </section>
}
