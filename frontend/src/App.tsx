import './App.css'
import Header from './components/Header'
import DownloadPage from './pages/DownloadPage'
import UploadPage from './pages/UploadPage'
import DevicePanel from './components/DevicePanel'
import { useState } from 'react'
import type { RememberedDevice } from './api'

function App() {
  const [peers, setPeers] = useState<RememberedDevice[]>([])
  const match = window.location.pathname.match(/^\/d\/([^/]+)\/?$/)
  const pairingPage = window.location.pathname === '/pair'
  const pairToken = pairingPage ? new URLSearchParams(window.location.hash.slice(1)).get('token') : null
  return (
    <div className="page">
      <Header />
      {match ? <DownloadPage token={match[1]} /> : <>
        {pairingPage && !pairToken && <p className="error" role="alert">This pairing link is incomplete. Scan a new QR code from your other device.</p>}
        {!pairingPage && <nav className="transfer-navigation" aria-label="File transfer actions">
          <a className="button primary" href="#send">Send file</a>
          <a className="button secondary" href="#receive">Receive files</a>
          <a className="button secondary" href="#connect">Connect a device</a>
        </nav>}
        <DevicePanel onPeers={setPeers} pairToken={pairToken} />
        {!pairingPage && <div id="send"><UploadPage peers={peers} /></div>}
      </>}
    </div>
  )
}

export default App
