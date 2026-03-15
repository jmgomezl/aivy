// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AivyVault — On-chain spending guardrails for AI agents on Hedera
/// @notice Each vault-protected agent deploys this contract to enforce spending caps
///         at the EVM level. Even if the AI hallucinates a large transfer, the vault blocks it.
contract AivyVault {
    address public owner;
    string public agentName;
    string public hederaAccountId;
    uint256 public spendingCapTinybar;
    bool public paused;
    string public policyLabel;

    event VaultProvisioned(string agentName, string hederaAccountId, uint256 spendingCapTinybar, string policyLabel);
    event GuardrailsUpdated(uint256 spendingCapTinybar, bool paused, string policyLabel);
    event ExecutionLogged(string action, uint256 amountTinybar, string targetAccountId, string note);

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
        emit VaultProvisioned(_agentName, _hederaAccountId, _spendingCapTinybar, _policyLabel);
    }

    /// @notice Update spending cap, pause state, and policy label
    function updateGuardrails(
        uint256 _spendingCapTinybar,
        bool _paused,
        string calldata _policyLabel
    ) external onlyOwner {
        spendingCapTinybar = _spendingCapTinybar;
        paused = _paused;
        policyLabel = _policyLabel;
        emit GuardrailsUpdated(_spendingCapTinybar, _paused, _policyLabel);
    }

    /// @notice Log an agent execution — reverts if paused or amount exceeds spending cap
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
}
