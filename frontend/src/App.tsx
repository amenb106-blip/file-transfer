import './App.css'
import DownloadPage from './pages/DownloadPage'
import UploadPage from './pages/UploadPage'

function App() {
  // Share links look like /d/<token>. Every other path shows the upload page.
  const match = window.location.pathname.match(/^\/d\/([^/]+)\/?$/)
  return match ? <DownloadPage token={match[1]} /> : <UploadPage />
}

export default App
