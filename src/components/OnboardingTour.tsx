import { useState } from 'react'
import './OnboardingTour.css'

const steps = [
  {
    title: 'Welcome to Aivy',
    body: 'Your AI agent control room on Hedera. Deploy autonomous agents that manage tokens, run compliance, and govern DAOs — all with on-chain safety.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5ad6b5" strokeWidth="1.5">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    title: 'Deploy Agents',
    body: 'Click "+ Deploy Agent" to launch a specialist. Each agent gets its own Hedera account, vault smart contract, and spending cap.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f3c35f" strokeWidth="1.5">
        <path d="M12 5v14M5 12h14" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  },
  {
    title: 'Chat & Command',
    body: 'Talk to any agent using the chat bar. Ask questions, give instructions, or let the AI route your message to the right specialist automatically.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7f95d1" strokeWidth="1.5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    title: 'Audit Everything',
    body: 'Every transaction is logged on-chain via the Hedera Consensus Service. Click any agent to see its history, export audit reports, and verify on-chain.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f25f5c" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
]

export default function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const current = steps[step]

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      localStorage.setItem('aivy-onboarded', '1')
      onComplete()
    }
  }

  const skip = () => {
    localStorage.setItem('aivy-onboarded', '1')
    onComplete()
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-icon">{current.icon}</div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>

        <div className="onboarding-dots">
          {steps.map((s, i) => (
            <span
              className={`onboarding-dot ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}
              key={s.title}
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="onboarding-skip" onClick={skip} type="button">
            Skip
          </button>
          <button className="onboarding-next" onClick={next} type="button">
            {step < steps.length - 1 ? 'Next' : 'Get Started'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <span className="onboarding-step-label">
          {step + 1} of {steps.length}
        </span>
      </div>
    </div>
  )
}
