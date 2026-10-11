import { formatSize } from '../api'
import { FileIcon } from './icons'

function FileSummary({ name, size }: { name: string; size: number }) {
  return (
    <>
      <span className="file-icon"><FileIcon size={20} /></span>
      <span className="file-text">
        <span className="file-name">{name}</span>
        <span className="muted small">{formatSize(size)}</span>
      </span>
    </>
  )
}

export default FileSummary
