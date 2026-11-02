import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { ApiError } from '../api'
import { cancelInvitation, claimInvitation, confirmPairing, createInvitation, getPairing, inspectInvitation, problemMessage } from '../deviceApi'
import type { Invitation, Pairing } from '../deviceApi'

export default function PairDevices({ token, onConnected }: { token: string | null; onConnected: () => void }) {
  const [invite, setInvite] = useState<Invitation | null>(null)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [watchId, setWatchId] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [copied, setCopied] = useState(false)
  const link = invite ? `${window.location.origin}/pair#token=${invite.token}` : ''

  useEffect(() => {
    if (!token) return
    let active = true
    inspectInvitation(token).then(value => { if (active) setPairing(value) })
      .catch(error => { if (active) setError(problemMessage(error)) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!watchId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      let again = true
      try {
        const state = await getPairing(watchId!, controller.signal)
        if (controller.signal.aborted) return
        setPairing(state)
        setError('')
        if (state.status === 'paired') { again = false; setWatchId(null); onConnected() }
      } catch (error) {
        if (controller.signal.aborted) return
        setError(problemMessage(error))
        if (error instanceof ApiError && [401, 404, 410].includes(error.status)) {
          again = false; setExpired(true); setWatchId(null)
        }
      }
      if (again && !controller.signal.aborted) timer = setTimeout(poll, 2500)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [watchId, onConnected])

  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError(problemMessage(error)) }
    finally { setBusy(false) }
  }

  async function start() {
    const created = await createInvitation()
    setInvite(created); setPairing(null); setExpired(false); setCopied(false); setWatchId(created.id)
    setQr(await QRCode.toDataURL(`${window.location.origin}/pair#token=${created.token}`, { width: 320, margin: 4 }).catch(() => ''))
  }

  async function copyLink() {
    setError('')
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('Could not copy the link. Select it and copy it yourself.')
    }
  }

  if (pairing?.status === 'paired' && !expired) return <div className="field">
    <p role="status">Connected to {token ? pairing.owner_name : pairing.claimant?.name}.</p>
    {token ? <a className="button secondary" href="/">Send a file</a>
      : <div><button className="button secondary" disabled={busy} onClick={() => act(start)}>Add another device</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>

  return <section className="field" aria-label="Connect devices">
    {!token && <ol className="pairing-steps">
      <li><strong>Scan the QR</strong><span>Create a QR here and scan it with your other device.</span></li>
      <li><strong>Request connection</strong><span>Save the other device if needed, then request to connect.</span></li>
      <li><strong>Approve here</strong><span>Check its name and approve. Keep this page open until connected.</span></li>
    </ol>}
    {token ? <>
      {pairing && <p>Connect this browser to <strong>{pairing.owner_name}</strong>?</p>}
      {watchId ? <p role="status">Waiting for approval on {pairing?.owner_name}…</p>
        : <div><button className="button primary" disabled={busy || !pairing || expired} onClick={() => act(async () => {
          const result = await claimInvitation(token); setPairing(result)
          if (result.status === 'paired') onConnected(); else setWatchId(result.id)
        })}>{busy ? 'Connecting…' : 'Request connection'}</button></div>}
      <a href="/">Back to transfers</a>
    </> : <>
      {!invite || expired ? <div><button className="button secondary" disabled={busy} onClick={() => act(start)}>
        {busy ? 'Creating…' : 'Create pairing QR'}
      </button></div> : <>
        <p className="muted small">Scan this QR with your other device, then approve its name here. Expires at {new Date(invite.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
        <div className="pairing-code">
          {qr && <img src={qr} width={160} height={160} alt="Scan on your other device to request pairing" />}
          <div className="field">
            <label className="field" htmlFor="pair-link"><span className="field-label">Pairing link</span><input id="pair-link" className="input mono" value={link} readOnly onFocus={e => e.target.select()} /></label>
            <div className="actions"><button className="button secondary" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
              <button className="button secondary" disabled={busy} onClick={() => act(async () => {
                await cancelInvitation(invite.id); setInvite(null); setPairing(null); setWatchId(null); setQr('')
              })}>Cancel pairing</button></div>
          </div>
        </div>
        {pairing?.claimant ? <div className="field"><p><strong>{pairing.claimant.name}</strong> wants to connect. Approve only if this is your device.</p>
          <div><button className="button primary" disabled={busy} onClick={() => act(async () => {
            const result = await confirmPairing(invite.id, pairing.claimant!.id); setPairing(result); setWatchId(null); onConnected()
          })}>Approve {pairing.claimant.name}</button></div></div>
          : <p className="muted small" role="status">Waiting for your other device…</p>}
      </>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
