import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type TransferRecord = {
  id: string
  filename: string
  expires_at: string
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [apiStatus, setApiStatus] = useState('Connecting...')
  const [passcode, setPasscode] = useState('')
  const [saving, setSaving] = useState(false)
  const [transfer, setTransfer] = useState<TransferRecord | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Backend request failed')
        return response.json()
      })
      .then((data) => {
        setApiStatus(data.status === 'ok' ? 'Connected' : 'Unexpected response')
      })
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus('Backend unavailable')
      })
    return () => controller.abort()
  }, [])

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !passcode || saving || transfer) return
    setError('')
    setSaving(true)

    try {
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Passcode': passcode,
        },
        body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
      })
      if (!response.ok) {
        const message = response.status === 401
          ? 'Incorrect upload passcode. Try again.'
          : response.status === 422
            ? 'The file name or size is not accepted. Choose another file.'
            : 'Could not save the transfer. Check that the backend and database are available.'
        throw new Error(message)
      }
      setTransfer(await response.json())
      setPasscode('')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not reach the backend.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main>
      <h1>File Transfer</h1>
      <p>Backend: {apiStatus}</p>
      <p>Choose a file to send to another device.</p>

      <form onSubmit={createTransfer}>
        <label htmlFor="file">Choose a file</label>
        <input
          id="file"
          type="file"
          disabled={saving}
          onChange={(event) => {
            const selectedFile = event.target.files?.[0] ?? null

            setError('')
            setFile(null)
            setTransfer(null)

            if (selectedFile && (selectedFile.size === 0 || selectedFile.size > 25 * 1024 * 1024)) {
              setError('Choose a nonempty file no larger than 25 MB.')
              event.target.value = ''
              return
            }

            setFile(selectedFile)
          }}
        />

        {file && (
          <p>
            {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        )}

        <label htmlFor="passcode">Upload passcode</label>
        <input
          id="passcode"
          type="password"
          autoComplete="off"
          value={passcode}
          disabled={saving}
          onChange={(event) => setPasscode(event.target.value)}
          required
        />
        <button type="submit" disabled={!file || !passcode || saving || Boolean(transfer)}>
          {saving ? 'Saving...' : 'Create transfer record'}
        </button>
      </form>

      {error && <p role="alert">{error}</p>}
      {transfer && (
        <section aria-live="polite">
          <h2>Transfer record saved</h2>
          <p>{transfer.filename}</p>
          <p>Transfer ID: {transfer.id}</p>
          <p>Expires: {new Date(transfer.expires_at).toLocaleString()}</p>
          <p>Your file has not been uploaded yet. File upload is the next step.</p>
        </section>
      )}
    </main>
  )
}

export default App
