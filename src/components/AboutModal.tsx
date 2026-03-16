import './AboutModal.css'

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
  if (!open) return null

  return (
    <div className="about-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about-modal">
        <button className="about-close" onClick={onClose} type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="about-scroll">
          {/* Header */}
          <header className="about-header">
            <img className="about-logo" src="/logo-192.png" alt="Aivy" />
            <div>
              <h1 className="about-title">Aivy Architecture</h1>
              <p className="about-sub">On-chain smart contracts powering trustless AI agent operations on Hedera</p>
            </div>
          </header>

          {/* ─── AivyVault ─────────────────────────── */}
          <section className="about-section">
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

          {/* ─── ERC-8183 ──────────────────────────── */}
          <section className="about-section">
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
          <section className="about-section about-section--compact">
            <h2 className="about-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Tech Stack
            </h2>
            <div className="about-stack">
              <span className="about-stack-chip">Hedera Agent Kit</span>
              <span className="about-stack-chip">Solidity ^0.8.24</span>
              <span className="about-stack-chip">OpenAI GPT-4o</span>
              <span className="about-stack-chip">React + Vite</span>
              <span className="about-stack-chip">Phaser 3</span>
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
