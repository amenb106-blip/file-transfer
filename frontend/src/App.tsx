import './App.css'
import Header from './components/Header'
import DownloadPage from './pages/DownloadPage'
import UploadPage from './pages/UploadPage'
import DevicePanel from './components/DevicePanel'
import { useState } from 'react'
import type { RememberedDevice } from './api'

function App() {
  const [peers, setPeers] = useState<RememberedDevice[]>([])
  const [device, setDevice] = useState<RememberedDevice | null>(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [view, setView] = useState<'send' | 'receive' | 'connect'>('send')
  const match = window.location.pathname.match(/^\/d\/([^/]+)\/?$/)
  const pairingPage = window.location.pathname === '/pair'
  const pairToken = pairingPage ? new URLSearchParams(window.location.hash.slice(1)).get('token') : null
  return (
    <div className="page">
      <Header />
      {match ? <DownloadPage token={match[1]} /> : <>
        {pairingPage && !pairToken && <p className="error" role="alert">This pairing link is incomplete. Scan a new QR code from your other device.</p>}
        {device && <p className="current-device">This device: <strong>{device.name}</strong></p>}
        {!pairingPage && <nav className="transfer-navigation" aria-label="File transfer actions">
          <button type="button" aria-pressed={view === 'send'} onClick={() => setView('send')}>Send file</button>
          <button type="button" aria-pressed={view === 'receive'} onClick={() => setView('receive')}>Receive files <span className="inbox-count" aria-live="polite">{inboxCount}</span></button>
          <button type="button" aria-pressed={view === 'connect'} onClick={() => setView('connect')}>Connect a device</button>
        </nav>}
        {!pairingPage && <div id="send" hidden={view !== 'send'}><UploadPage peers={peers} onConnect={() => setView('connect')} onReceive={() => setView('receive')} /></div>}
        <DevicePanel onPeers={setPeers} pairToken={pairToken} view={pairingPage ? 'connect' : view}
          onCount={setInboxCount} onDevice={setDevice} onConnect={() => setView('connect')} />
      </>}
    </div>
  )
}

export default App
