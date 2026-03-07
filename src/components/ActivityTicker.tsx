import { useState } from 'react'
import type { ActivityEvent } from '../types'
import './ActivityTicker.css'

type ActivityTickerProps = {
  events: ActivityEvent[]
}

export default function ActivityTicker({ events }: ActivityTickerProps) {
  const [expanded, setExpanded] = useState(false)
  const recent = events.slice(0, 5)
  const latest = recent[0]

  if (!latest) return null

  return (
    <div className="activity-ticker-wrapper">
      <button
        className="ticker-bar"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <span className="ticker-dot" />
        <span className="ticker-text">{latest.label}</span>
        <span className="ticker-time">{latest.timestamp}</span>
        <span className="ticker-toggle">{expanded ? 'Hide' : `${recent.length} events`}</span>
      </button>

      {expanded && (
        <div className="ticker-feed">
          {recent.map((event) => (
            <div className={`ticker-event ${event.tone}`} key={event.id}>
              <p>{event.label}</p>
              <span>{event.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
