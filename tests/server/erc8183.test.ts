import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

// Must set env before importing db
process.env.MASTER_ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

import { initMasterKey } from '../../server/crypto'
import * as db from '../../server/db'

const __dirname = dirname(fileURLToPath(import.meta.url))

beforeAll(() => {
  initMasterKey()
})

// ─── Contract Compilation ─────────────────────────────────
describe('AivyJobManager contract compilation', () => {
  const source = readFileSync(
    resolve(__dirname, '..', '..', 'contracts', 'AivyJobManager.sol'),
    'utf-8',
  )

  it('compiles successfully with solc', () => {
    const input = {
      language: 'Solidity',
      sources: { 'AivyJobManager.sol': { content: source } },
      settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
    }

    const output = JSON.parse(solc.compile(JSON.stringify(input)))
    const errors = output.errors?.filter((e: { severity: string }) => e.severity === 'error') ?? []
    expect(errors).toHaveLength(0)

    const contract = output.contracts?.['AivyJobManager.sol']?.AivyJobManager
    expect(contract).toBeDefined()
    expect(contract.abi).toBeDefined()
    expect(contract.abi.length).toBeGreaterThan(0)
    expect(contract.evm.bytecode.object).toBeTruthy()
  })

  it('ABI contains expected function signatures', () => {
    const input = {
      language: 'Solidity',
      sources: { 'AivyJobManager.sol': { content: source } },
      settings: { outputSelection: { '*': { '*': ['abi'] } } },
    }

    const output = JSON.parse(solc.compile(JSON.stringify(input)))
    const abi = output.contracts['AivyJobManager.sol'].AivyJobManager.abi as Array<{
      type: string
      name?: string
    }>

    const functionNames = abi
      .filter((item) => item.type === 'function')
      .map((item) => item.name)

    expect(functionNames).toContain('createJob')
    expect(functionNames).toContain('fund')
    expect(functionNames).toContain('submit')
    expect(functionNames).toContain('complete')
    expect(functionNames).toContain('reject')
    expect(functionNames).toContain('claimRefund')
    expect(functionNames).toContain('getJob')
    expect(functionNames).toContain('getJobCount')
  })

  it('ABI contains expected events', () => {
    const input = {
      language: 'Solidity',
      sources: { 'AivyJobManager.sol': { content: source } },
      settings: { outputSelection: { '*': { '*': ['abi'] } } },
    }

    const output = JSON.parse(solc.compile(JSON.stringify(input)))
    const abi = output.contracts['AivyJobManager.sol'].AivyJobManager.abi as Array<{
      type: string
      name?: string
    }>

    const eventNames = abi
      .filter((item) => item.type === 'event')
      .map((item) => item.name)

    expect(eventNames).toContain('JobCreated')
    expect(eventNames).toContain('JobFunded')
    expect(eventNames).toContain('JobSubmitted')
    expect(eventNames).toContain('JobCompleted')
    expect(eventNames).toContain('JobRejected')
    expect(eventNames).toContain('JobExpired')
    expect(eventNames).toContain('JobRefunded')
  })

  it('IACPHook interface is included in compilation', () => {
    const input = {
      language: 'Solidity',
      sources: { 'AivyJobManager.sol': { content: source } },
      settings: { outputSelection: { '*': { '*': ['abi'] } } },
    }

    const output = JSON.parse(solc.compile(JSON.stringify(input)))
    // IACPHook should compile as a separate contract entry
    expect(output.contracts['AivyJobManager.sol'].IACPHook).toBeDefined()
  })
})

// ─── Job Lifecycle (DB-level) ─────────────────────────────
describe('Job lifecycle (database)', () => {
  // Create test agents first
  const clientAgentId = `test-client-${Date.now()}`
  const providerAgentId = `test-provider-${Date.now()}`
  const userId = 'test-user-erc8183'

  beforeAll(() => {
    // Insert test agents
    db.insertDeployment({
      id: clientAgentId,
      userId,
      templateId: 'treasury-sentinel',
      name: 'Test Client Agent',
      room: 'room-1',
      guardrail: 'test guardrail',
      vaultProtected: true,
      capabilityGroups: ['accounts'],
      status: 'active',
      lastAction: '',
      executions: 0,
      createdAt: new Date().toISOString(),
      topicId: null,
      contractId: null,
      contractAddress: null,
      deploymentTxId: null,
      vaultCapHbar: 100,
      agentAccountId: '0.0.999001',
      agentPrivateKey: null,
      walletType: 'platform',
    })

    db.insertDeployment({
      id: providerAgentId,
      userId,
      templateId: 'yield-router',
      name: 'Test Provider Agent',
      room: 'room-2',
      guardrail: 'test guardrail',
      vaultProtected: false,
      capabilityGroups: ['tokens'],
      status: 'active',
      lastAction: '',
      executions: 0,
      createdAt: new Date().toISOString(),
      topicId: null,
      contractId: null,
      contractAddress: null,
      deploymentTxId: null,
      vaultCapHbar: 0,
      agentAccountId: '0.0.999002',
      agentPrivateKey: null,
      walletType: 'platform',
    })
  })

  it('inserts a job with Open status', () => {
    const jobId = `job-test-${Date.now()}-1`
    const job: db.JobRecord = {
      id: jobId,
      jobChainId: 1,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: '0.0.100',
      description: 'Analyze token performance',
      budgetHbar: 5.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Open',
      deliverable: null,
      contractId: '0.0.600001',
      txId: 'tx-test-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    db.insertJob(job)
    const fetched = db.getJob(jobId)
    expect(fetched).not.toBeNull()
    expect(fetched!.status).toBe('Open')
    expect(fetched!.clientAgentId).toBe(clientAgentId)
    expect(fetched!.providerAgentId).toBe(providerAgentId)
    expect(fetched!.budgetHbar).toBe(5.0)
    expect(fetched!.description).toBe('Analyze token performance')
  })

  it('transitions Open → Funded', () => {
    const jobId = `job-test-${Date.now()}-2`
    db.insertJob({
      id: jobId,
      jobChainId: 2,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Transfer audit',
      budgetHbar: 10.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Open',
      deliverable: null,
      contractId: null,
      txId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    db.updateJobStatus(jobId, 'Funded', null, 'tx-funded-1')
    const fetched = db.getJob(jobId)
    expect(fetched!.status).toBe('Funded')
    expect(fetched!.txId).toBe('tx-funded-1')
  })

  it('transitions Funded → Submitted with deliverable', () => {
    const jobId = `job-test-${Date.now()}-3`
    db.insertJob({
      id: jobId,
      jobChainId: 3,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Token analysis',
      budgetHbar: 2.5,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Funded',
      deliverable: null,
      contractId: null,
      txId: 'tx-3',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    db.updateJobStatus(jobId, 'Submitted', 'Analysis report: all tokens healthy')
    const fetched = db.getJob(jobId)
    expect(fetched!.status).toBe('Submitted')
    expect(fetched!.deliverable).toBe('Analysis report: all tokens healthy')
  })

  it('transitions Submitted → Completed', () => {
    const jobId = `job-test-${Date.now()}-4`
    db.insertJob({
      id: jobId,
      jobChainId: 4,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Balance check',
      budgetHbar: 1.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Submitted',
      deliverable: 'Balance verified',
      contractId: null,
      txId: 'tx-4',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    db.updateJobStatus(jobId, 'Completed', null, 'tx-4-pay')
    const fetched = db.getJob(jobId)
    expect(fetched!.status).toBe('Completed')
    expect(fetched!.txId).toBe('tx-4-pay')
  })

  it('transitions Submitted → Rejected', () => {
    const jobId = `job-test-${Date.now()}-5`
    db.insertJob({
      id: jobId,
      jobChainId: 5,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Report generation',
      budgetHbar: 3.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Submitted',
      deliverable: 'Incomplete report',
      contractId: null,
      txId: 'tx-5',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    db.updateJobStatus(jobId, 'Rejected')
    const fetched = db.getJob(jobId)
    expect(fetched!.status).toBe('Rejected')
  })

  it('returns null for non-existent job', () => {
    const fetched = db.getJob('non-existent-job')
    expect(fetched).toBeNull()
  })

  it('getJobsByAgent returns jobs for both client and provider roles', () => {
    // Insert a job for the test
    const jobId = `job-test-${Date.now()}-6`
    db.insertJob({
      id: jobId,
      jobChainId: 6,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Cross-agent task',
      budgetHbar: 7.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Open',
      deliverable: null,
      contractId: null,
      txId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const clientJobs = db.getJobsByAgent(clientAgentId)
    expect(clientJobs.length).toBeGreaterThanOrEqual(1)
    expect(clientJobs.some((j) => j.id === jobId)).toBe(true)

    const providerJobs = db.getJobsByAgent(providerAgentId)
    expect(providerJobs.length).toBeGreaterThanOrEqual(1)
    expect(providerJobs.some((j) => j.id === jobId)).toBe(true)
  })

  it('getJobsByUser returns jobs for user agents', () => {
    const jobs = db.getJobsByUser(userId)
    expect(jobs.length).toBeGreaterThanOrEqual(1)
  })

  it('updateJobStatus preserves deliverable when not provided', () => {
    const jobId = `job-test-${Date.now()}-7`
    db.insertJob({
      id: jobId,
      jobChainId: 7,
      clientAgentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Preserve test',
      budgetHbar: 1.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Submitted',
      deliverable: 'Original deliverable',
      contractId: null,
      txId: 'tx-7',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    db.updateJobStatus(jobId, 'Completed')
    const fetched = db.getJob(jobId)
    expect(fetched!.deliverable).toBe('Original deliverable')
  })

  it('updateJobStatus on non-existent job does nothing', () => {
    expect(() => db.updateJobStatus('nonexistent', 'Funded')).not.toThrow()
  })
})

// ─── Vault Cap Integration ────────────────────────────────
describe('Vault cap + ERC-8183 integration', () => {
  const agentId = `vault-agent-${Date.now()}`
  const providerAgentId = `vault-provider-${Date.now()}`

  beforeAll(() => {
    db.insertDeployment({
      id: agentId,
      userId: 'vault-test-user',
      templateId: 'treasury-sentinel',
      name: 'Vault-Protected Agent',
      room: 'room-1',
      guardrail: 'max 50 HBAR',
      vaultProtected: true,
      capabilityGroups: ['accounts'],
      status: 'active',
      lastAction: '',
      executions: 0,
      createdAt: new Date().toISOString(),
      topicId: null,
      contractId: '0.0.600099',
      contractAddress: null,
      deploymentTxId: null,
      vaultCapHbar: 50,
      agentAccountId: '0.0.999099',
      agentPrivateKey: null,
      walletType: 'platform',
    })

    db.insertDeployment({
      id: providerAgentId,
      userId: 'vault-test-user',
      templateId: 'yield-router',
      name: 'Provider Agent',
      room: 'room-2',
      guardrail: 'none',
      vaultProtected: false,
      capabilityGroups: ['tokens'],
      status: 'active',
      lastAction: '',
      executions: 0,
      createdAt: new Date().toISOString(),
      topicId: null,
      contractId: null,
      contractAddress: null,
      deploymentTxId: null,
      vaultCapHbar: 0,
      agentAccountId: '0.0.999098',
      agentPrivateKey: null,
      walletType: 'platform',
    })
  })

  it('spending cap check: allows funding within cap', () => {
    const agent = db.getDeployment(agentId)!
    expect(agent.vaultProtected).toBe(true)
    expect(agent.vaultCapHbar).toBe(50)

    const summary = db.getSpendingSummary(agentId)
    const jobBudget = 20
    const canFund = summary.totalSpent + jobBudget <= agent.vaultCapHbar
    expect(canFund).toBe(true)
  })

  it('spending cap check: blocks funding when cap exceeded', () => {
    // Record spending up to cap
    db.recordSpending(agentId, 45, 'outflow', 'test_tool', 'tx-cap', 'chat', 'test spending')

    const summary = db.getSpendingSummary(agentId)
    const jobBudget = 10
    const canFund = summary.totalSpent + jobBudget <= 50
    expect(canFund).toBe(false)
  })

  it('spending is recorded when job is funded', () => {
    const jobId = `job-vault-${Date.now()}`
    db.insertJob({
      id: jobId,
      jobChainId: 100,
      clientAgentId: agentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Vault cap test job',
      budgetHbar: 2.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Open',
      deliverable: null,
      contractId: null,
      txId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Simulate funding: record spending
    db.recordSpending(
      agentId,
      2.0,
      'outflow',
      'erc8183_fund',
      'tx-vault-fund',
      'chat',
      'Funded ERC-8183 job',
    )
    db.updateJobStatus(jobId, 'Funded', null, 'tx-vault-fund')

    const job = db.getJob(jobId)!
    expect(job.status).toBe('Funded')

    // Check spending is reflected
    const spending = db.getSpendingByAgent(agentId)
    expect(spending.some((s) => s.toolName === 'erc8183_fund')).toBe(true)
  })

  it('refund records inflow on rejection', () => {
    const jobId = `job-refund-${Date.now()}`
    db.insertJob({
      id: jobId,
      jobChainId: 101,
      clientAgentId: agentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Refund test job',
      budgetHbar: 3.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Funded',
      deliverable: null,
      contractId: null,
      txId: 'tx-refund-test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Reject and refund
    db.updateJobStatus(jobId, 'Rejected')
    db.recordSpending(
      agentId,
      3.0,
      'inflow',
      'erc8183_refund',
      'tx-refund',
      'chat',
      'Refund for rejected job',
    )

    const spending = db.getSpendingByAgent(agentId)
    const refundRecord = spending.find((s) => s.toolName === 'erc8183_refund')
    expect(refundRecord).toBeDefined()
    expect(refundRecord!.direction).toBe('inflow')
    expect(refundRecord!.amountHbar).toBe(3.0)
  })

  it('payout records inflow to provider on completion', () => {
    const jobId = `job-payout-${Date.now()}`
    db.insertJob({
      id: jobId,
      jobChainId: 102,
      clientAgentId: agentId,
      providerAgentId,
      evaluatorAddress: null,
      description: 'Payout test job',
      budgetHbar: 5.0,
      expiredAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'Submitted',
      deliverable: 'Work done',
      contractId: null,
      txId: 'tx-payout-test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Complete and pay
    db.updateJobStatus(jobId, 'Completed', null, 'tx-payout')
    db.recordSpending(
      providerAgentId,
      5.0,
      'inflow',
      'erc8183_payout',
      'tx-payout',
      'chat',
      'Payout for completed job',
    )

    const spending = db.getSpendingByAgent(providerAgentId)
    const payoutRecord = spending.find((s) => s.toolName === 'erc8183_payout')
    expect(payoutRecord).toBeDefined()
    expect(payoutRecord!.direction).toBe('inflow')
    expect(payoutRecord!.amountHbar).toBe(5.0)
  })
})
