// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IACPHook — ERC-8183 hook interface for extensibility
/// @notice Implement this interface to add custom logic before/after job actions
interface IACPHook {
    /// @notice Called before a job action; return false to block the action
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external returns (bool);

    /// @notice Called after a job action for side effects (e.g., reputation updates)
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}

/// @title AivyJobManager — ERC-8183 Agentic Commerce Protocol for Hedera
/// @notice Manages trustless job lifecycle for agent-to-agent settlements.
///         Works alongside AivyVault: the platform checks vault spending caps
///         before allowing an agent to fund a job.
contract AivyJobManager {
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
        string deliverable;
    }

    address public owner;
    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;
    uint256[] public jobIds;

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, uint256 budget, string description);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, string deliverable);
    event JobCompleted(uint256 indexed jobId, uint256 payout);
    event JobRejected(uint256 indexed jobId, string reason);
    event JobExpired(uint256 indexed jobId);
    event JobRefunded(uint256 indexed jobId, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    constructor() {
        owner = msg.sender;
        nextJobId = 1;
    }

    /// @notice Create a new job between a client and provider agent
    /// @param provider Address of the provider agent's operator
    /// @param evaluator Address that will judge deliverables (platform or 3rd agent)
    /// @param description Human-readable task specification
    /// @param budget Payment amount in tinybar
    /// @param expiredAt Unix timestamp deadline
    /// @param hook Optional IACPHook contract address (address(0) to skip)
    function createJob(
        address provider,
        address evaluator,
        string calldata description,
        uint256 budget,
        uint256 expiredAt,
        address hook
    ) external returns (uint256) {
        require(provider != address(0), "invalid provider");
        require(evaluator != address(0), "invalid evaluator");
        require(budget > 0, "budget must be positive");
        require(expiredAt > block.timestamp, "expiry must be future");

        uint256 jobId = nextJobId++;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: budget,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: hook,
            deliverable: ""
        });
        jobIds.push(jobId);

        emit JobCreated(jobId, msg.sender, provider, budget, description);
        return jobId;
    }

    /// @notice Fund the job escrow — HBAR is held in this contract until settlement
    /// @dev The platform should check the client agent's AivyVault spending cap before calling this
    function fund(uint256 jobId) external payable {
        Job storage job = jobs[jobId];
        require(job.id != 0, "job not found");
        require(msg.sender == job.client, "not client");
        require(job.status == JobStatus.Open, "not open");
        require(msg.value >= job.budget, "insufficient funds");

        job.status = JobStatus.Funded;
        emit JobFunded(jobId, msg.value);
    }

    /// @notice Provider submits their deliverable for evaluation
    function submit(uint256 jobId, string calldata deliverable) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "job not found");
        require(msg.sender == job.provider, "not provider");
        require(job.status == JobStatus.Funded, "not funded");

        // Hook: beforeAction
        if (job.hook != address(0)) {
            try IACPHook(job.hook).beforeAction(jobId, this.submit.selector, msg.data) returns (bool ok) {
                require(ok, "hook rejected submit");
            } catch {}
        }

        job.deliverable = deliverable;
        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, deliverable);

        // Hook: afterAction
        if (job.hook != address(0)) {
            try IACPHook(job.hook).afterAction(jobId, this.submit.selector, msg.data) {} catch {}
        }
    }

    /// @notice Evaluator approves the deliverable and releases payment to provider
    function complete(uint256 jobId, string calldata reason) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "job not found");
        require(msg.sender == job.evaluator, "not evaluator");
        require(job.status == JobStatus.Submitted, "not submitted");

        // Hook: beforeAction
        if (job.hook != address(0)) {
            try IACPHook(job.hook).beforeAction(jobId, this.complete.selector, msg.data) returns (bool ok) {
                require(ok, "hook rejected complete");
            } catch {}
        }

        job.status = JobStatus.Completed;

        // Pay provider
        uint256 payout = job.budget;
        (bool sent, ) = payable(job.provider).call{value: payout}("");
        require(sent, "payment failed");

        emit JobCompleted(jobId, payout);

        // Hook: afterAction
        if (job.hook != address(0)) {
            try IACPHook(job.hook).afterAction(jobId, this.complete.selector, msg.data) {} catch {}
        }
    }

    /// @notice Evaluator rejects the deliverable
    function reject(uint256 jobId, string calldata reason) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "job not found");
        require(msg.sender == job.evaluator, "not evaluator");
        require(job.status == JobStatus.Submitted || job.status == JobStatus.Funded, "not rejectable");

        job.status = JobStatus.Rejected;
        emit JobRejected(jobId, reason);
    }

    /// @notice Client reclaims escrowed HBAR after rejection or expiry
    function claimRefund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "job not found");
        require(msg.sender == job.client, "not client");

        if (job.status == JobStatus.Funded && block.timestamp > job.expiredAt) {
            job.status = JobStatus.Expired;
            emit JobExpired(jobId);
        }

        require(
            job.status == JobStatus.Rejected || job.status == JobStatus.Expired,
            "not refundable"
        );

        uint256 refundAmount = job.budget;
        (bool sent, ) = payable(job.client).call{value: refundAmount}("");
        require(sent, "refund failed");

        emit JobRefunded(jobId, refundAmount);
    }

    /// @notice Get full job details
    function getJob(uint256 jobId) external view returns (Job memory) {
        require(jobs[jobId].id != 0, "job not found");
        return jobs[jobId];
    }

    /// @notice Get total number of jobs created
    function getJobCount() external view returns (uint256) {
        return jobIds.length;
    }

    receive() external payable {}
}
