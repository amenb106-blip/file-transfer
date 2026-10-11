import type { ReactNode } from 'react'
import { CheckIcon } from './icons'

const steps = ['Choose file', 'Send file', 'Share link']

function TransferLayout({ title, step, children }: {
  title: string
  step?: 0 | 1 | 2
  children: ReactNode
}) {
  return (
    <main className={`workspace${step === undefined ? ' workspace-simple' : ''}`}>
      {step !== undefined && (
        <aside className="transfer-sidebar" aria-label="Transfer progress">
          <h2>Transfer</h2>
          <ol className="transfer-steps">
            {steps.map((label, index) => (
              <li
                key={label}
                className={index < step ? 'done' : undefined}
                aria-current={index === step ? 'step' : undefined}
              >
                <span className="step-number" aria-hidden="true">
                  {index < step ? <CheckIcon size={13} /> : index + 1}
                </span>
                <span>{label}</span>
                {index < step && <span className="visually-hidden"> (complete)</span>}
              </li>
            ))}
          </ol>
        </aside>
      )}
      <section className="workspace-body" aria-labelledby="page-title">
        <div className="panel-heading">
          <h1 id="page-title" aria-live="polite">{title}</h1>
          {step === 2 && <span className="success-icon"><CheckIcon size={20} /></span>}
        </div>
        {children}
      </section>
    </main>
  )
}

export default TransferLayout
