import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, getCurrentDevice, rememberDevice } from '../api'
import type { RememberedDevice } from '../api'
import { disconnectDevice, getPeers, problemMessage } from '../deviceApi'
import PairDevices from './PairDevices'
import DeviceInbox from './DeviceInbox'

export default function DevicePanel({ onPeers, pairToken, view, onCount, onDevice, onConnect }: {
  onPeers: (peers: RememberedDevice[]) => void; pairToken: string | null
  view: 'send' | 'receive' | 'connect'; onCount: (count: number) => void
  onDevice: (device: RememberedDevice | null) => void; onConnect: () => void
}) {
  const [device, setDevice] = useState<RememberedDevice | null>(null)
  const [name, setName] = useState('')
  const [passcode, setPasscode] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [peers, setPeers] = useState<RememberedDevice[]>([])
  const [peerError, setPeerError] = useState('')

  useEffect(() => {
    onDevice(device)
    if (!device) onCount(0)
  }, [device, onDevice, onCount])

  const refreshPeers = useCallback(async (signal?: AbortSignal) => {
    if (!device) return
    try {
      const items = await getPeers(signal)
      if (signal?.aborted) return
      setPeers(items); onPeers(items); setPeerError('')
    } catch (error) {
      if (signal?.aborted) return
      setPeerError(problemMessage(error))
      if (error instanceof ApiError && error.status === 401) { setDevice(null); setPeers([]); onPeers([]) }
    }
  }, [device, onPeers])

  useEffect(() => {
    if (!device) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      await refreshPeers(controller.signal)
      if (!controller.signal.aborted) timer = setTimeout(refresh, 8000)
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [device, refreshPeers])

  const connected = useCallback(() => { void refreshPeers() }, [refreshPeers])

  useEffect(() => {
    const controller = new AbortController()
    getCurrentDevice(controller.signal).then(setDevice).catch(() => {
      if (!controller.signal.aborted) setError('Could not check this device. You can still upload files.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !name.trim() || !passcode) return
    setSaving(true)
    setError('')
    try {
      const saved = await rememberDevice(name.trim(), passcode)
      const recognized = await getCurrentDevice()
      if (recognized?.id !== saved.id) throw new Error('Your browser could not remember this device. Check that cookies are allowed.')
      setDevice(recognized)
      setPasscode('')
    } catch (problem) {
      setError(problem instanceof ApiError && problem.status === 422
        ? 'Enter a device name between 1 and 64 characters, without control characters.'
        : problem instanceof Error ? problem.message : 'Could not remember this device.')
    } finally { setSaving(false) }
  }

  return <section className="device-panel" aria-label="Your devices and incoming files" hidden={view === 'send'}>
    <div id="connect" hidden={view !== 'connect'}>
    <h2 className="device-heading">Connect a device</h2>
    <p className="muted small">Connect once, then choose your phone or laptop under Send to whenever you send a file.</p>
    {loading ? <p className="muted small" role="status">Checking this device…</p>
      : device ? <div>
        <p>This device: <strong>{device.name}</strong></p>
        <div className="device-sections">
          <PairDevices token={pairToken} onConnected={connected} />
          <details className="connected-settings">
            <summary>Connected devices ({peers.length})</summary>
            {!peers.length && <p className="muted small">Pair your phone or laptop to send files directly.</p>}
            {peers.map(peer => <div className="peer-row" key={peer.id}><span>{peer.name}</span>
              <button className="button secondary" disabled={saving} onClick={async () => {
                setSaving(true); setPeerError('')
                try { await disconnectDevice(peer.id); await refreshPeers() }
                catch (error) { setPeerError(problemMessage(error)) }
                finally { setSaving(false) }
              }}>Disconnect</button>
            </div>)}
            {peerError && <p className="error" role="alert">{peerError}</p>}
          </details>
        </div>
      </div>
      : <div>
        <form className="field" onSubmit={save} aria-busy={saving}>
          <p className="muted small">{pairToken ? 'Name this browser and enter your upload passcode to continue pairing.' : 'Save this browser to pair your devices and receive files here.'}</p>
          <label className="field" htmlFor="device-name"><span className="field-label">Device name</span>
            <input id="device-name" className="input" placeholder="My laptop" maxLength={64} required
              value={name} onChange={event => setName(event.target.value)} disabled={saving} />
          </label>
          <label className="field" htmlFor="device-passcode"><span className="field-label">Upload passcode</span>
            <input id="device-passcode" className="input" type="password" autoComplete="current-password" required
              value={passcode} onChange={event => setPasscode(event.target.value)} disabled={saving} />
          </label>
          <div><button className="button secondary" disabled={saving || !name.trim() || !passcode}>
            {saving ? 'Saving…' : 'Save device'}
          </button></div>
        </form>
      </div>}
    {error && <p role="alert" className="error">{error}</p>}
    </div>
    <div id="receive" hidden={view !== 'receive'}>
      {device ? <DeviceInbox key={device.id} deviceId={device.id} onCount={onCount} /> : <>
        <h2 className="device-heading">Receive files</h2>
        <p className="muted small">Save this device and connect your phone or laptop. Files sent here will appear automatically.</p>
        <button type="button" className="button primary" onClick={onConnect}>Connect a device</button>
      </>}
    </div>
  </section>
}
