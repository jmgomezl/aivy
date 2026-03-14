import { type CSSProperties, useState } from 'react'
import { templates, roomCards } from '../data'
import './Landing.css'

/* ── AivyVault Solidity source (deployed per-agent on Hedera) ── */
const VAULT_SOLIDITY = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AivyVault {
    address public owner;
    string  public agentName;
    string  public hederaAccountId;
    uint256 public spendingCapTinybar;
    bool    public paused;
    string  public policyLabel;

    event VaultProvisioned(string agentName, string hederaAccountId,
                           uint256 spendingCapTinybar, string policyLabel);
    event GuardrailsUpdated(uint256 spendingCapTinybar, bool paused,
                            string policyLabel);
    event ExecutionLogged(string action, uint256 amountTinybar,
                          string targetAccountId, string note);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    constructor(
        string memory _agentName,
        string memory _hederaAccountId,
        uint256 _spendingCapTinybar,
        string memory _policyLabel
    ) payable {
        owner = msg.sender;
        agentName = _agentName;
        hederaAccountId = _hederaAccountId;
        spendingCapTinybar = _spendingCapTinybar;
        policyLabel = _policyLabel;
        emit VaultProvisioned(_agentName, _hederaAccountId,
                              _spendingCapTinybar, _policyLabel);
    }

    function updateGuardrails(
        uint256 _capTinybar, bool _paused, string calldata _label
    ) external onlyOwner {
        spendingCapTinybar = _capTinybar;
        paused = _paused;
        policyLabel = _label;
        emit GuardrailsUpdated(_capTinybar, _paused, _label);
    }

    function logExecution(
        string calldata action,
        uint256 amountTinybar,
        string calldata targetAccountId,
        string calldata note
    ) external onlyOwner {
        require(!paused, "vault paused");
        require(amountTinybar <= spendingCapTinybar, "cap exceeded");
        emit ExecutionLogged(action, amountTinybar, targetAccountId, note);
    }

    receive() external payable {}
}`

type LandingProps = {
  onEnter: () => void
  onTryDemo: () => Promise<void> | void
}

/* Each agent: walk class + bubble text */
const walkConfigs = [
  { walkClass: 'walk-ts', bubble: 'Balance: 142.5 HBAR' },
  { walkClass: 'walk-yr', bubble: 'Token minted!' },
  { walkClass: 'walk-cc', bubble: 'Audit logged on-chain' },
  { walkClass: 'walk-gr', bubble: 'Proposal submitted' },
]

/* Inter-agent data transfers with source/dest room centers
   Each renders: 3 trail particles + send ring + receive beacon */
const dataTransfers = [
  { id: 'lb-wr', cls: 'p-lb-wr', color: '#ff9a3c', delay: '0s',  src: { x: 25, y: 27 }, dst: { x: 73, y: 75 } },
  { id: 'sp-fd', cls: 'p-sp-fd', color: '#4ecdc4', delay: '6s',  src: { x: 73, y: 27 }, dst: { x: 25, y: 75 } },
  { id: 'fd-lb', cls: 'p-fd-lb', color: '#7f95d1', delay: '12s', src: { x: 25, y: 75 }, dst: { x: 25, y: 27 } },
  { id: 'wr-sp', cls: 'p-wr-sp', color: '#f25f5c', delay: '18s', src: { x: 73, y: 75 }, dst: { x: 73, y: 27 } },
]

/* Activity ticker entries */
const demoTickerItems = [
  { text: 'Treasury Sentinel deployed with vault guardrails', tone: 'vault' },
  { text: 'Yield Router: Token minted \u2014 1,000 AIVY', tone: 'success' },
  { text: 'Compliance Clerk: Audit record published', tone: 'system' },
  { text: 'Governance Relay: Proposal topic created', tone: 'success' },
  { text: 'Treasury Sentinel: Transferred 25 HBAR', tone: 'vault' },
]

export default function Landing({ onEnter, onTryDemo }: LandingProps) {
  const [demoLoading, setDemoLoading] = useState(false)

  const handleDemo = async () => {
    setDemoLoading(true)
    try {
      await onTryDemo()
    } finally {
      setDemoLoading(false)
    }
  }

  return (
    <div className="landing">
      <div className="landing-content">
        <header className="landing-header" style={{ animationDelay: '0s' }}>
          <img className="landing-brand-logo" src="/logo-192.png" alt="Aivy" />
          <h1 className="landing-title">Aivy</h1>
          <p className="landing-tagline">
            Deploy AI Agents on Hedera in 60 Seconds
          </p>
        </header>

        <div className="landing-office-preview" style={{ animationDelay: '0.2s' }}>
          <div className="preview-office">
            {roomCards.map((room) => (
              <div className={`preview-room ${room.className}`} key={room.name}>
                <span className="preview-room-label">{room.name}</span>
              </div>
            ))}

            {/* Walking agents */}
            {templates.map((template, index) => {
              const cfg = walkConfigs[index]
              return (
                <div
                  className={`preview-agent ${cfg.walkClass}`}
                  key={template.id}
                  style={{ '--sprite-color': template.color } as CSSProperties}
                >
                  <img alt="" className="pixel-image" src={template.sprite} />
                  <span className="preview-agent-ring" />
                  <span className="demo-work-dots">
                    <span /><span /><span />
                  </span>
                  <span className="demo-bubble">{cfg.bubble}</span>
                </div>
              )
            })}

            {/* Inter-agent data transfers */}
            {dataTransfers.map((t) => (
              <span key={t.id}>
                {/* Trail particles (3 dots) */}
                {[0, 1, 2].map((i) => (
                  <span
                    key={`${t.id}-p${i}`}
                    className={`demo-particle ${t.cls}`}
                    style={{
                      '--p-color': t.color,
                      '--p-trail': `${i * 0.18}s`,
                    } as CSSProperties}
                  />
                ))}

                {/* Send ring — expands from source on departure */}
                <span
                  className="demo-send-ring"
                  style={{
                    left: `${t.src.x}%`,
                    top: `${t.src.y}%`,
                    '--p-color': t.color,
                    '--t-delay': t.delay,
                  } as CSSProperties}
                />

                {/* Receive beacon — pulses at dest while waiting, flashes on arrival */}
                <span
                  className="demo-recv-beacon"
                  style={{
                    left: `${t.dst.x}%`,
                    top: `${t.dst.y}%`,
                    '--p-color': t.color,
                    '--t-delay': t.delay,
                  } as CSSProperties}
                />
              </span>
            ))}
          </div>

          {/* Activity ticker */}
          <div className="demo-ticker">
            <div className="demo-ticker-track">
              {[...demoTickerItems, ...demoTickerItems].map((item, i) => (
                <span className={`demo-ticker-item demo-ticker-${item.tone}`} key={`${item.text}-${i}`}>
                  {item.text}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="landing-pillars" style={{ animationDelay: '0.4s' }}>
          <div className="pillar">
            <div className="pillar-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <h3>Visual Office</h3>
            <p>Watch your agents work in a pixel art workspace</p>
          </div>

          <div className="pillar">
            <div className="pillar-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3>Safe Vaults</h3>
            <p>On-chain spending caps and guardrails for every agent</p>
          </div>

          <div className="pillar">
            <div className="pillar-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <h3>50+ Tools</h3>
            <p>Full Hedera Agent Kit: tokens, contracts, consensus</p>
          </div>
        </div>

        <div className="landing-cta-group" style={{ animationDelay: '0.5s' }}>
          <button
            className="landing-cta"
            onClick={onEnter}
            type="button"
          >
            Enter the Office
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
          <button
            className={`landing-cta-demo${demoLoading ? ' is-loading' : ''}`}
            onClick={handleDemo}
            disabled={demoLoading}
            type="button"
          >
            {demoLoading ? (
              <>
                <svg className="demo-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
                  </path>
                </svg>
                Deploying on Hedera...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Try Demo
              </>
            )}
          </button>
        </div>

        {/* ── Vault Architecture Showcase ── */}
        <section className="vault-showcase" style={{ animationDelay: '0.5s' }}>
          <h2 className="vault-showcase-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            On-Chain Vault Architecture
          </h2>
          <p className="vault-showcase-sub">
            Every agent deploys its own <strong>AivyVault</strong> smart contract on Hedera &mdash; spending caps are enforced at the EVM level, not just in application code.
          </p>

          {/* Architecture flow */}
          <div className="vault-flow">
            <div className="vault-flow-step">
              <span className="vault-flow-num">1</span>
              <span className="vault-flow-label">Deploy Agent</span>
            </div>
            <span className="vault-flow-arrow">&rarr;</span>
            <div className="vault-flow-step">
              <span className="vault-flow-num">2</span>
              <span className="vault-flow-label">Create Vault Contract</span>
            </div>
            <span className="vault-flow-arrow">&rarr;</span>
            <div className="vault-flow-step">
              <span className="vault-flow-num">3</span>
              <span className="vault-flow-label">Enforce Caps On-Chain</span>
            </div>
          </div>

          {/* Solidity source */}
          <div className="vault-code-wrap">
            <div className="vault-code-header">
              <span className="vault-code-dot" />
              <span className="vault-code-dot" />
              <span className="vault-code-dot" />
              <span className="vault-code-filename">AivyVault.sol</span>
            </div>
            <pre className="vault-code"><code>{VAULT_SOLIDITY.trim()}</code></pre>
          </div>

          {/* Feature cards */}
          <div className="vault-features">
            <div className="vault-feat">
              <div className="vault-feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h4>Spending Cap</h4>
              <p>On-chain <code>require(amount &lt;= cap)</code> prevents any overspend&mdash;even if the app is compromised</p>
            </div>
            <div className="vault-feat">
              <div className="vault-feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </div>
              <h4>Pause Control</h4>
              <p>Owner can freeze vault operations instantly with a single transaction</p>
            </div>
            <div className="vault-feat">
              <div className="vault-feat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <h4>Audit Trail</h4>
              <p>Every execution emits on-chain events for full transparency and compliance</p>
            </div>
          </div>
        </section>

        <p className="landing-powered" style={{ animationDelay: '0.7s' }}>
          Powered by <strong>Hedera Agent Kit</strong> &middot; Built for APEX Hackathon &middot; <strong>AivyLabs</strong>
        </p>
      </div>
    </div>
  )
}
