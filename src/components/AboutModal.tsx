import { useRef, useState, useEffect, useCallback } from 'react'
import './AboutModal.css'

const NAV_ITEMS = [
  { id: 'vault', label: 'AivyVault', icon: 'shield' },
  { id: 'kms', label: 'AWS KMS', icon: 'lock' },
  { id: 'erc8183', label: 'ERC-8183', icon: 'transfer' },
  { id: 'stack', label: 'Tech Stack', icon: 'bolt' },
] as const

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

const JOB_MANAGER_EXCERPT = `// ERC-8183 Agentic Commerce Protocol
contract AivyJobManager {
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        uint256 id;
        address client;      // Agent A's operator
        address provider;    // Agent B's operator
        address evaluator;   // Platform or 3rd agent
        string  description;
        uint256 budget;      // tinybar
        uint256 expiredAt;   // deadline
        JobStatus status;
        address hook;        // Optional IACPHook
        string  deliverable;
    }

    // Client creates a job, funds escrow with HBAR
    function createJob(...) external returns (uint256);
    function fund(uint256 jobId) external payable;

    // Provider delivers, evaluator approves or rejects
    function submit(uint256 jobId, string calldata deliverable) external;
    function complete(uint256 jobId, string calldata reason) external;
    function reject(uint256 jobId, string calldata reason) external;

    // Client reclaims on rejection/expiry
    function claimRefund(uint256 jobId) external;
}`

type AboutModalProps = {
  open: boolean
  onClose: () => void
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeNav, setActiveNav] = useState('vault')

  const scrollToSection = useCallback((id: string) => {
    const el = scrollRef.current?.querySelector(`#about-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveNav(id)
    }
  }, [])

  // Track which section is in view via IntersectionObserver
  useEffect(() => {
    if (!open || !scrollRef.current) return
    const sections = scrollRef.current.querySelectorAll('[data-nav-section]')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.navSection
            if (id) setActiveNav(id)
          }
        }
      },
      { root: scrollRef.current, rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [open])

  if (!open) return null

  return (
    <div className="about-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about-modal">
        <button className="about-close" onClick={onClose} type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Sticky section navigator */}
        <nav className="about-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`about-nav-item${activeNav === item.id ? ' about-nav-item--active' : ''}${item.id === 'kms' ? ' about-nav-item--kms' : ''}`}
              onClick={() => scrollToSection(item.id)}
              type="button"
            >
              {item.icon === 'shield' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              )}
              {item.icon === 'lock' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              )}
              {item.icon === 'transfer' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
              )}
              {item.icon === 'bolt' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              )}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="about-scroll" ref={scrollRef}>
          {/* Header */}
          <header className="about-header">
            <img className="about-logo" src="/logo-192.png" alt="Aivy" />
            <div>
              <h1 className="about-title">Aivy Architecture</h1>
              <p className="about-sub">Three-layer defense-in-depth: AWS KMS + on-chain vaults + application security</p>
            </div>
          </header>

          {/* ─── AivyVault ─────────────────────────── */}
          <section id="about-vault" data-nav-section="vault" className="about-section">
            <h2 className="about-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              AivyVault — Per-Agent Spending Caps
            </h2>
            <p className="about-desc">
              Every agent deploys its own <strong>AivyVault</strong> smart contract. Spending caps are enforced at the EVM level, not just in application code.
            </p>

            {/* Architecture flow */}
            <div className="about-flow">
              <div className="about-flow-step">
                <span className="about-flow-num">1</span>
                <span className="about-flow-label">Deploy Agent</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-flow-step">
                <span className="about-flow-num">2</span>
                <span className="about-flow-label">Create Vault Contract</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-flow-step">
                <span className="about-flow-num">3</span>
                <span className="about-flow-label">Enforce Caps On-Chain</span>
              </div>
            </div>

            {/* Code block */}
            <div className="about-code-wrap">
              <div className="about-code-header">
                <span className="about-code-dot" />
                <span className="about-code-dot" />
                <span className="about-code-dot" />
                <span className="about-code-filename">AivyVault.sol</span>
              </div>
              <pre className="about-code"><code>{VAULT_SOLIDITY.trim()}</code></pre>
            </div>

            {/* Feature cards */}
            <div className="about-features">
              <div className="about-feat">
                <div className="about-feat-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </div>
                <h4>Spending Cap</h4>
                <p>On-chain <code>require(amount &lt;= cap)</code> prevents any overspend</p>
              </div>
              <div className="about-feat">
                <div className="about-feat-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <h4>Pause Control</h4>
                <p>Owner can freeze vault operations instantly with a single transaction</p>
              </div>
              <div className="about-feat">
                <div className="about-feat-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <h4>Audit Trail</h4>
                <p>Every execution emits on-chain events for full transparency</p>
              </div>
            </div>
          </section>

          {/* ─── AWS KMS ──────────────────────────── */}
          <section id="about-kms" data-nav-section="kms" className="about-section about-section--kms">
            <h2 className="about-section-title about-section-title--kms">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
                <circle cx="12" cy="16" r="1" />
              </svg>
              AWS KMS — Envelope Encryption
              <span className="about-kms-badge">Secure Key Management</span>
            </h2>
            <p className="about-desc">
              Every agent's Hedera signing key is protected by a <strong>dedicated AWS KMS symmetric key</strong>. Private keys are <strong>never stored in plaintext</strong> — encrypted at rest, decrypted in-memory only for signing ({'<'} 50ms), then wiped.
            </p>

            {/* KMS signing flow */}
            <div className="about-kms-flow">
              <div className="about-kms-flow-step">
                <span className="about-kms-flow-icon">🔐</span>
                <span className="about-kms-flow-text">Agent needs to sign</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-kms-flow-step">
                <span className="about-kms-flow-icon">☁️</span>
                <span className="about-kms-flow-text">KMS Decrypt {'<'} 50ms</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-kms-flow-step">
                <span className="about-kms-flow-icon">✍️</span>
                <span className="about-kms-flow-text">Sign Hedera Tx</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-kms-flow-step">
                <span className="about-kms-flow-icon">🧹</span>
                <span className="about-kms-flow-text">Wipe key memory</span>
              </div>
            </div>

            {/* Key lifecycle diagram */}
            <div className="about-kms-lifecycle">
              <h3 className="about-kms-lifecycle-title">Key Lifecycle</h3>
              <div className="about-kms-lc-row">
                <span className="about-kms-lc-step about-kms-lc--create">
                  <span className="about-kms-lc-num">1</span>
                  Create KMS Key
                </span>
                <span className="about-kms-lc-arrow">&rarr;</span>
                <span className="about-kms-lc-step about-kms-lc--encrypt">
                  <span className="about-kms-lc-num">2</span>
                  Encrypt Ed25519
                </span>
                <span className="about-kms-lc-arrow">&rarr;</span>
                <span className="about-kms-lc-step about-kms-lc--sign">
                  <span className="about-kms-lc-num">3</span>
                  Sign Transactions
                </span>
                <span className="about-kms-lc-arrow">&rarr;</span>
                <span className="about-kms-lc-step about-kms-lc--rotate">
                  <span className="about-kms-lc-num">4</span>
                  Auto-Rotate
                </span>
              </div>
            </div>

            {/* Code snippet */}
            <div className="about-code-wrap about-code-wrap--kms">
              <div className="about-code-header">
                <span className="about-code-dot" />
                <span className="about-code-dot" />
                <span className="about-code-dot" />
                <span className="about-code-filename">server/kms.ts</span>
                <span className="about-code-badge about-code-badge--kms">AWS KMS</span>
              </div>
              <pre className="about-code"><code>{`// Envelope encryption: KMS encrypts the agent's private key
const { CiphertextBlob } = await kms.send(new EncryptCommand({
  KeyId: agentKmsKeyId,
  Plaintext: privateKeyBytes,
  EncryptionContext: {
    platform: 'aivy',
    agent: agentId,
    keyType: 'ed25519-signing'
  }
}));
// Store only ciphertext — private key NEVER touches disk

// Transaction signing: decrypt in-memory, sign, wipe
const { Plaintext } = await kms.send(new DecryptCommand({
  CiphertextBlob: storedCiphertext,
  EncryptionContext: { platform: 'aivy', agent: agentId, keyType: 'ed25519-signing' }
}));
const key = PrivateKey.fromBytesED25519(Plaintext);
const signed = await transaction.sign(key);
Buffer.from(Plaintext).fill(0); // Wipe from memory`}</code></pre>
            </div>

            {/* KMS feature cards */}
            <div className="about-features">
              <div className="about-feat about-feat--kms">
                <div className="about-feat-icon about-feat-icon--kms">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                </div>
                <h4>Per-Agent Keys</h4>
                <p>Each agent gets its own dedicated KMS symmetric key — blast radius = 1 agent</p>
              </div>
              <div className="about-feat about-feat--kms">
                <div className="about-feat-icon about-feat-icon--kms">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </div>
                <h4>Encryption Context</h4>
                <p>Decrypt requires matching <code>{'platform + agent + keyType'}</code> — prevents cross-agent access</p>
              </div>
              <div className="about-feat about-feat--kms">
                <div className="about-feat-icon about-feat-icon--kms">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <h4>CloudTrail Audit</h4>
                <p>Every KMS operation logged in AWS CloudTrail for full compliance visibility</p>
              </div>
            </div>

            {/* Three-layer defense diagram */}
            <div className="about-kms-defense">
              <h3 className="about-kms-lifecycle-title">Three-Layer Defense-in-Depth</h3>
              <div className="about-defense-layers">
                <div className="about-defense-layer about-defense-layer--kms">
                  <span className="about-defense-layer-label">Layer 3</span>
                  <span className="about-defense-layer-name">AWS KMS</span>
                  <span className="about-defense-layer-desc">Envelope encryption &middot; CloudTrail &middot; Auto-rotation</span>
                </div>
                <div className="about-defense-layer about-defense-layer--vault">
                  <span className="about-defense-layer-label">Layer 2</span>
                  <span className="about-defense-layer-name">AivyVault.sol</span>
                  <span className="about-defense-layer-desc">On-chain spending caps &middot; Solidity guardrails</span>
                </div>
                <div className="about-defense-layer about-defense-layer--app">
                  <span className="about-defense-layer-label">Layer 1</span>
                  <span className="about-defense-layer-name">Application</span>
                  <span className="about-defense-layer-desc">JWT &middot; AES-256-GCM &middot; Rate limits &middot; RBAC</span>
                </div>
              </div>
            </div>
          </section>

          {/* ─── ERC-8183 ──────────────────────────── */}
          <section id="about-erc8183" data-nav-section="erc8183" className="about-section">
            <h2 className="about-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              ERC-8183 — Agent-to-Agent Settlements
            </h2>
            <p className="about-desc">
              Trustless job lifecycle for agent-to-agent commerce. One agent creates a job, escrows HBAR, and pays another upon delivery. <strong>AivyVault</strong> caps are checked before funding.
            </p>

            {/* Settlement flow */}
            <div className="about-flow">
              <div className="about-flow-step">
                <span className="about-flow-num">1</span>
                <span className="about-flow-label">Create Job</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-flow-step">
                <span className="about-flow-num">2</span>
                <span className="about-flow-label">Escrow HBAR</span>
              </div>
              <span className="about-flow-arrow">&rarr;</span>
              <div className="about-flow-step">
                <span className="about-flow-num">3</span>
                <span className="about-flow-label">Submit &amp; Settle</span>
              </div>
            </div>

            {/* Lifecycle diagram */}
            <div className="about-lifecycle">
              <div className="about-lc-row">
                <span className="about-lc-status about-lc-open">Open</span>
                <span className="about-lc-arrow">&rarr;</span>
                <span className="about-lc-status about-lc-funded">Funded</span>
                <span className="about-lc-arrow">&rarr;</span>
                <span className="about-lc-status about-lc-submitted">Submitted</span>
                <span className="about-lc-arrow">&rarr;</span>
                <span className="about-lc-status about-lc-completed">Completed</span>
              </div>
              <div className="about-lc-branches">
                <span className="about-lc-branch">
                  <span className="about-lc-arrow">&darr;</span>
                  <span className="about-lc-status about-lc-rejected">Rejected</span>
                  <span className="about-lc-arrow">&rarr;</span>
                  <span className="about-lc-refund">Refund</span>
                </span>
                <span className="about-lc-branch">
                  <span className="about-lc-arrow">&darr;</span>
                  <span className="about-lc-status about-lc-expired">Expired</span>
                  <span className="about-lc-arrow">&rarr;</span>
                  <span className="about-lc-refund">Refund</span>
                </span>
              </div>
            </div>

            {/* Code block */}
            <div className="about-code-wrap">
              <div className="about-code-header">
                <span className="about-code-dot" />
                <span className="about-code-dot" />
                <span className="about-code-dot" />
                <span className="about-code-filename">AivyJobManager.sol</span>
                <span className="about-code-badge">ERC-8183</span>
              </div>
              <pre className="about-code"><code>{JOB_MANAGER_EXCERPT.trim()}</code></pre>
            </div>

            {/* Integration points */}
            <div className="about-features">
              <div className="about-feat">
                <div className="about-feat-icon about-feat-icon--amber">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
                <h4>Escrow</h4>
                <p>HBAR locked in contract until job is completed or refunded</p>
              </div>
              <div className="about-feat">
                <div className="about-feat-icon about-feat-icon--amber">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h4>Vault Bridge</h4>
                <p>Spending cap checked before funding &mdash; vault + settlement layers</p>
              </div>
              <div className="about-feat">
                <div className="about-feat-icon about-feat-icon--amber">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <h4>IACPHook</h4>
                <p>Optional hook contract for custom logic before/after job actions</p>
              </div>
            </div>
          </section>

          {/* ─── Tech Stack ────────────────────────── */}
          <section id="about-stack" data-nav-section="stack" className="about-section about-section--compact">
            <h2 className="about-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Tech Stack
            </h2>
            <div className="about-stack">
              <span className="about-stack-chip about-stack-chip--kms">AWS KMS</span>
              <span className="about-stack-chip">Hedera Agent Kit</span>
              <span className="about-stack-chip">Solidity ^0.8.24</span>
              <span className="about-stack-chip">OpenAI GPT-4o</span>
              <span className="about-stack-chip">React + Vite</span>
              <span className="about-stack-chip">Express</span>
              <span className="about-stack-chip">SQLite</span>
              <span className="about-stack-chip">HashConnect</span>
              <span className="about-stack-chip">Mirror Node API</span>
            </div>
          </section>

          <p className="about-footer">
            Built for <strong>APEX Hackathon</strong> &middot; <strong>AivyLabs</strong>
          </p>
        </div>
      </div>
    </div>
  )
}
