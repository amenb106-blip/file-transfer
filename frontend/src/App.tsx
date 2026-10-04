import './App.css'
import Header from './components/Header'
import DownloadPage from './pages/DownloadPage'
import UploadPage from './pages/UploadPage'

function App() {
  // Share links look like /d/<token>. Every other path shows the upload page.
  const match = window.location.pathname.match(/^\/d\/([^/]+)\/?$/)
  return (
    <div className="page">
      <Header />
      {match ? <DownloadPage token={match[1]} /> : <UploadPage />}
    </div>
  )
}

export default App
