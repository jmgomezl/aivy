import { useState } from 'react'
import type { ResultDrawerState } from '../types'
import './ResultDrawer.css'

type ResultDrawerProps = {
  drawer: ResultDrawerState
  onClose: () => void
}

export default function ResultDrawer({ drawer, onClose }: ResultDrawerProps) {
  const [copiedValue, setCopiedValue] = useState('')

  const copyReference = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      window.setTimeout(() => {
        setCopiedValue((current) => (current === value ? '' : current))
      }, 1600)
    } catch {
      // clipboard access failed
    }
  }

  return (
    <aside className="result-drawer-v2">
      <div className="rd-header">
        <div>
          <span className="tl-kicker">Last result</span>
          <h3>{drawer.title}</h3>
        </div>
        <button className="dm-close" onClick={onClose} type="button" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="rd-message">{drawer.message}</p>

      {drawer.references.length > 0 ? (
        <div className="rd-refs">
          {drawer.references.map((ref) => (
            <div className="rd-ref" key={`${ref.label}-${ref.value}`}>
              <div className="rd-ref-top">
                <span>{ref.label}</span>
                <span className="rd-ref-type">{ref.type}</span>
              </div>
              <strong>{ref.value}</strong>
              <div className="rd-ref-actions">
                {ref.url && (
                  <a
                    className="tl-small-btn"
                    href={ref.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open mirror
                  </a>
                )}
                <button
                  className="tl-small-btn"
                  onClick={() => copyReference(ref.value)}
                  type="button"
                >
                  {copiedValue === ref.value ? 'Copied' : 'Copy ID'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rd-empty">No on-chain references returned.</p>
      )}
    </aside>
  )
}
