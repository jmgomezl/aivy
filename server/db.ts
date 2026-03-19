import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { encrypt, decrypt, isEncrypted } from './crypto.js'

/** Safely parse JSON from DB columns — returns fallback on corrupted data instead of crashing */
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    console.warn('[db] Failed to parse JSON column, using fallback:', value?.slice(0, 80))
    return fallback
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const DB_FILE = path.join(DATA_DIR, 'aivy.db')
const OLD_JSON = path.join(DATA_DIR, 'deployments.json')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_FILE)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── Schema ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    hedera_account_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    template_id TEXT NOT NULL,
    name TEXT NOT NULL,
    room TEXT NOT NULL,
    guardrail TEXT NOT NULL,
    vault_protected INTEGER NOT NULL DEFAULT 0,
    capability_groups TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'deploying',
    last_action TEXT NOT NULL DEFAULT '',
    executions INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    topic_id TEXT,
    contract_id TEXT,
    contract_address TEXT,
    deployment_tx_id TEXT,
    vault_cap_hbar REAL NOT NULL DEFAULT 0,
    agent_account_id TEXT,
    agent_private_key_encrypted TEXT,
    wallet_type TEXT NOT NULL DEFAULT 'platform',
    kms_key_id TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    deployment_id TEXT,
    label TEXT NOT NULL,
    tone TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS spending_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    amount_hbar REAL NOT NULL,
    direction TEXT NOT NULL DEFAULT 'outflow',
    tool_name TEXT,
    tx_id TEXT,
    source TEXT NOT NULL DEFAULT 'chat',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_deployments_user ON deployments(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_deployment ON chat_messages(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_spending_deployment ON spending_records(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_spending_created ON spending_records(created_at);

  CREATE TABLE IF NOT EXISTS agent_schedules (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    cron_expression TEXT NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schedule_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id TEXT NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
    deployment_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    result_summary TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS event_triggers (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    prompt_template TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_checked_at TEXT,
    last_triggered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    job_chain_id INTEGER NOT NULL,
    client_agent_id TEXT NOT NULL,
    provider_agent_id TEXT NOT NULL,
    evaluator_address TEXT,
    description TEXT NOT NULL,
    budget_hbar REAL NOT NULL,
    expired_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open',
    deliverable TEXT,
    contract_id TEXT,
    tx_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_schedules_deployment ON agent_schedules(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_schedule_exec_schedule ON schedule_executions(schedule_id);
  CREATE INDEX IF NOT EXISTS idx_triggers_deployment ON event_triggers(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_agent_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_provider ON jobs(provider_agent_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`)

// ─── Migrations (add columns to existing DBs) ───────
try {
  db.exec(`ALTER TABLE deployments ADD COLUMN kms_key_id TEXT`)
} catch {
  // Column already exists — ignore
}

// ─── Types ───────────────────────────────────────────
export type DbUser = {
  id: string
  hederaAccountId: string
  displayName: string | null
  createdAt: string
  lastLoginAt: string | null
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

// ─── Row converters ──────────────────────────────────
type DeploymentRow = {
  id: string
  user_id: string
  template_id: string
  name: string
  room: string
  guardrail: string
  vault_protected: number
  capability_groups: string
  status: string
  last_action: string
  executions: number
  created_at: string
  topic_id: string | null
  contract_id: string | null
  contract_address: string | null
  deployment_tx_id: string | null
  vault_cap_hbar: number
  agent_account_id: string | null
  agent_private_key_encrypted: string | null
  wallet_type: string
  kms_key_id: string | null
}

export type DeploymentRecord = {
  id: string
  userId: string
  templateId: string
  name: string
  room: string
  guardrail: string
  vaultProtected: boolean
  capabilityGroups: string[]
  status: string
  lastAction: string
  executions: number
  createdAt: string
  topicId: string | null
  contractId: string | null
  contractAddress: string | null
  deploymentTxId: string | null
  vaultCapHbar: number
  agentAccountId: string | null
  agentPrivateKey: string | null
  walletType: string
  kmsKeyId: string | null
}

function rowToDeployment(row: DeploymentRow): DeploymentRecord {
  let privateKey: string | null = null
  if (row.agent_private_key_encrypted) {
    try {
      privateKey = isEncrypted(row.agent_private_key_encrypted)
        ? decrypt(row.agent_private_key_encrypted)
        : row.agent_private_key_encrypted
    } catch {
      console.error(`[Aivy] Failed to decrypt agent private key for deployment ${row.id}. Check MASTER_ENCRYPTION_KEY.`)
      privateKey = null
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    templateId: row.template_id,
    name: row.name,
    room: row.room,
    guardrail: row.guardrail,
    vaultProtected: row.vault_protected === 1,
    capabilityGroups: safeJsonParse<string[]>(row.capability_groups, []),
    status: row.status,
    lastAction: row.last_action,
    executions: row.executions,
    createdAt: row.created_at,
    topicId: row.topic_id,
    contractId: row.contract_id,
    contractAddress: row.contract_address,
    deploymentTxId: row.deployment_tx_id,
    vaultCapHbar: row.vault_cap_hbar,
    agentAccountId: row.agent_account_id,
    agentPrivateKey: privateKey,
    walletType: row.wallet_type,
    kmsKeyId: row.kms_key_id,
  }
}

// ─── Users ───────────────────────────────────────────
const stmtGetUser = db.prepare('SELECT * FROM users WHERE hedera_account_id = ?')
const stmtInsertUser = db.prepare(
  'INSERT OR IGNORE INTO users (id, hedera_account_id, display_name) VALUES (?, ?, ?)',
)
const stmtUpdateLogin = db.prepare(
  "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
)

export function getOrCreateUser(hederaAccountId: string): DbUser {
  let row = stmtGetUser.get(hederaAccountId) as
    | { id: string; hedera_account_id: string; display_name: string | null; created_at: string; last_login_at: string | null }
    | undefined

  if (!row) {
    const id = hederaAccountId // use account ID as user ID
    stmtInsertUser.run(id, hederaAccountId, null)
    row = stmtGetUser.get(hederaAccountId) as typeof row
  }

  stmtUpdateLogin.run(row!.id)

  return {
    id: row!.id,
    hederaAccountId: row!.hedera_account_id,
    displayName: row!.display_name,
    createdAt: row!.created_at,
    lastLoginAt: row!.last_login_at,
  }
}

// ─── Deployments ─────────────────────────────────────
const stmtGetDeployment = db.prepare('SELECT * FROM deployments WHERE id = ?')
const stmtGetByUser = db.prepare('SELECT * FROM deployments WHERE user_id = ?')
const stmtGetAll = db.prepare('SELECT * FROM deployments')
const stmtDeleteDeployment = db.prepare('DELETE FROM deployments WHERE id = ?')

const stmtInsertDeployment = db.prepare(`
  INSERT INTO deployments (
    id, user_id, template_id, name, room, guardrail, vault_protected,
    capability_groups, status, last_action, executions, created_at,
    topic_id, contract_id, contract_address, deployment_tx_id,
    vault_cap_hbar, agent_account_id, agent_private_key_encrypted, wallet_type, kms_key_id
  ) VALUES (
    @id, @user_id, @template_id, @name, @room, @guardrail, @vault_protected,
    @capability_groups, @status, @last_action, @executions, @created_at,
    @topic_id, @contract_id, @contract_address, @deployment_tx_id,
    @vault_cap_hbar, @agent_account_id, @agent_private_key_encrypted, @wallet_type, @kms_key_id
  )
`)

const stmtUpdateDeployment = db.prepare(`
  UPDATE deployments SET
    status = @status,
    last_action = @last_action,
    executions = @executions,
    topic_id = @topic_id,
    contract_id = @contract_id,
    contract_address = @contract_address,
    vault_cap_hbar = @vault_cap_hbar,
    agent_account_id = @agent_account_id,
    agent_private_key_encrypted = @agent_private_key_encrypted,
    kms_key_id = @kms_key_id
  WHERE id = @id
`)

export function getDeployment(id: string): DeploymentRecord | null {
  const row = stmtGetDeployment.get(id) as DeploymentRow | undefined
  return row ? rowToDeployment(row) : null
}

export function getDeploymentsByUser(userId: string): DeploymentRecord[] {
  const rows = stmtGetByUser.all(userId) as DeploymentRow[]
  return rows.map(rowToDeployment)
}

export function getAllDeployments(): DeploymentRecord[] {
  const rows = stmtGetAll.all() as DeploymentRow[]
  return rows.map(rowToDeployment)
}

export function insertDeployment(record: DeploymentRecord): void {
  const encryptedKey = record.agentPrivateKey ? encrypt(record.agentPrivateKey) : null
  stmtInsertDeployment.run({
    id: record.id,
    user_id: record.userId,
    template_id: record.templateId,
    name: record.name,
    room: record.room,
    guardrail: record.guardrail,
    vault_protected: record.vaultProtected ? 1 : 0,
    capability_groups: JSON.stringify(record.capabilityGroups),
    status: record.status,
    last_action: record.lastAction,
    executions: record.executions,
    created_at: record.createdAt,
    topic_id: record.topicId,
    contract_id: record.contractId,
    contract_address: record.contractAddress,
    deployment_tx_id: record.deploymentTxId,
    vault_cap_hbar: record.vaultCapHbar,
    agent_account_id: record.agentAccountId,
    agent_private_key_encrypted: encryptedKey,
    wallet_type: record.walletType,
    kms_key_id: record.kmsKeyId ?? null,
  })
}

export function updateDeployment(record: DeploymentRecord): void {
  const encryptedKey = record.agentPrivateKey ? encrypt(record.agentPrivateKey) : null
  stmtUpdateDeployment.run({
    id: record.id,
    status: record.status,
    last_action: record.lastAction,
    executions: record.executions,
    topic_id: record.topicId,
    contract_id: record.contractId,
    contract_address: record.contractAddress,
    vault_cap_hbar: record.vaultCapHbar,
    agent_account_id: record.agentAccountId,
    agent_private_key_encrypted: encryptedKey,
    kms_key_id: record.kmsKeyId ?? null,
  })
}

export function deleteDeployment(id: string): void {
  stmtDeleteDeployment.run(id)
  clearChatHistory(id)
}

export function clearAllDeployments(): void {
  db.exec('DELETE FROM deployments')
  db.exec('DELETE FROM chat_messages')
}

export function clearDeploymentsByUser(userId: string): void {
  const deploymentIds = db.prepare('SELECT id FROM deployments WHERE user_id = ?').all(userId) as Array<{ id: string }>
  const stmtDelChat = db.prepare('DELETE FROM chat_messages WHERE deployment_id = ?')
  for (const { id } of deploymentIds) {
    stmtDelChat.run(id)
  }
  db.prepare('DELETE FROM deployments WHERE user_id = ?').run(userId)
}

// ─── Activity Log ────────────────────────────────────
const stmtInsertActivity = db.prepare(
  'INSERT INTO activity_log (id, user_id, deployment_id, label, tone, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
)
const stmtGetActivity = db.prepare(
  'SELECT * FROM activity_log ORDER BY rowid DESC LIMIT ?',
)
const stmtGetActivityByUser = db.prepare(
  'SELECT * FROM activity_log WHERE user_id = ? ORDER BY rowid DESC LIMIT ?',
)

export function pushActivity(
  id: string,
  label: string,
  tone: string,
  timestamp: string,
  userId?: string,
  deploymentId?: string,
): void {
  stmtInsertActivity.run(id, userId ?? null, deploymentId ?? null, label, tone, timestamp)
}

export function getActivity(limit = 30): Array<{ id: string; label: string; tone: string; timestamp: string }> {
  return stmtGetActivity.all(limit) as Array<{ id: string; label: string; tone: string; timestamp: string }>
}

export function getActivityByUser(userId: string, limit = 30): Array<{ id: string; label: string; tone: string; timestamp: string }> {
  return stmtGetActivityByUser.all(userId, limit) as Array<{ id: string; label: string; tone: string; timestamp: string }>
}

export function getActivityForAgent(agentName: string, limit = 50): Array<{ id: string; label: string; tone: string; timestamp: string }> {
  const stmt = db.prepare(
    'SELECT * FROM activity_log WHERE label LIKE ? ORDER BY rowid DESC LIMIT ?',
  )
  return stmt.all(`%${agentName}%`, limit) as Array<{ id: string; label: string; tone: string; timestamp: string }>
}

export function clearActivity(): void {
  db.exec('DELETE FROM activity_log')
}

export function clearActivityByUser(userId: string): void {
  db.prepare('DELETE FROM activity_log WHERE user_id = ?').run(userId)
}

// ─── Chat Messages ───────────────────────────────────
const stmtGetChat = db.prepare(
  'SELECT * FROM chat_messages WHERE deployment_id = ? ORDER BY id ASC',
)
const stmtInsertChat = db.prepare(
  'INSERT INTO chat_messages (deployment_id, role, content, tool_calls, tool_call_id, tool_name) VALUES (?, ?, ?, ?, ?, ?)',
)
const stmtDeleteChat = db.prepare('DELETE FROM chat_messages WHERE deployment_id = ?')

export function getChatHistory(deploymentId: string): ChatMessage[] {
  const rows = stmtGetChat.all(deploymentId) as Array<{
    role: string
    content: string | null
    tool_calls: string | null
    tool_call_id: string | null
    tool_name: string | null
  }>

  return rows.map((row) => {
    const msg: ChatMessage = {
      role: row.role as ChatMessage['role'],
      content: row.content,
    }
    if (row.tool_calls) msg.tool_calls = safeJsonParse<ChatMessage['tool_calls']>(row.tool_calls, undefined)
    if (row.tool_call_id) msg.tool_call_id = row.tool_call_id
    if (row.tool_name) msg.name = row.tool_name
    return msg
  })
}

export function appendChatMessage(deploymentId: string, msg: ChatMessage): void {
  stmtInsertChat.run(
    deploymentId,
    msg.role,
    msg.content,
    msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
    msg.tool_call_id ?? null,
    msg.name ?? null,
  )
}

export function appendChatMessages(deploymentId: string, messages: ChatMessage[]): void {
  const tx = db.transaction(() => {
    for (const msg of messages) {
      appendChatMessage(deploymentId, msg)
    }
  })
  tx()
}

export function replaceChatHistory(deploymentId: string, messages: ChatMessage[]): void {
  const tx = db.transaction(() => {
    stmtDeleteChat.run(deploymentId)
    for (const msg of messages) {
      stmtInsertChat.run(
        deploymentId,
        msg.role,
        msg.content,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.tool_call_id ?? null,
        msg.name ?? null,
      )
    }
  })
  tx()
}

export function clearChatHistory(deploymentId: string): void {
  stmtDeleteChat.run(deploymentId)
}

export function clearAllChatHistory(): void {
  db.exec('DELETE FROM chat_messages')
}

export function clearChatHistoryByUser(userId: string): void {
  const deploymentIds = db.prepare('SELECT id FROM deployments WHERE user_id = ?').all(userId) as Array<{ id: string }>
  const stmtDel = db.prepare('DELETE FROM chat_messages WHERE deployment_id = ?')
  for (const { id } of deploymentIds) {
    stmtDel.run(id)
  }
}

// ─── Spending Records ────────────────────────────────
export type SpendingRecord = {
  id: number
  deploymentId: string
  amountHbar: number
  direction: 'outflow' | 'inflow'
  toolName: string | null
  txId: string | null
  source: 'chat' | 'schedule' | 'trigger' | 'funding'
  description: string | null
  createdAt: string
}

export type SpendingSummary = {
  totalSpent: number
  totalFunded: number
  txCount: number
}

type SpendingRow = {
  id: number
  deployment_id: string
  amount_hbar: number
  direction: string
  tool_name: string | null
  tx_id: string | null
  source: string
  description: string | null
  created_at: string
}

function rowToSpending(row: SpendingRow): SpendingRecord {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    amountHbar: row.amount_hbar,
    direction: row.direction as SpendingRecord['direction'],
    toolName: row.tool_name,
    txId: row.tx_id,
    source: row.source as SpendingRecord['source'],
    description: row.description,
    createdAt: row.created_at,
  }
}

const stmtInsertSpending = db.prepare(
  `INSERT INTO spending_records (deployment_id, amount_hbar, direction, tool_name, tx_id, source, description)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const stmtGetSpendingByAgent = db.prepare(
  'SELECT * FROM spending_records WHERE deployment_id = ? ORDER BY id DESC LIMIT ?',
)
const stmtGetSpendingSummary = db.prepare(
  `SELECT
     SUM(CASE WHEN direction='outflow' THEN amount_hbar ELSE 0 END) as total_spent,
     SUM(CASE WHEN direction='inflow' THEN amount_hbar ELSE 0 END) as total_funded,
     COUNT(*) as tx_count
   FROM spending_records WHERE deployment_id = ?`,
)
const stmtGetRecentSpending = db.prepare(
  'SELECT * FROM spending_records WHERE deployment_id = ? AND created_at >= ? ORDER BY id ASC',
)

export function recordSpending(
  deploymentId: string,
  amountHbar: number,
  direction: 'outflow' | 'inflow',
  toolName: string | null,
  txId: string | null,
  source: 'chat' | 'schedule' | 'trigger' | 'funding',
  description: string | null,
): void {
  stmtInsertSpending.run(deploymentId, amountHbar, direction, toolName, txId, source, description)
}

export function getSpendingByAgent(deploymentId: string, limit = 50): SpendingRecord[] {
  const rows = stmtGetSpendingByAgent.all(deploymentId, limit) as SpendingRow[]
  return rows.map(rowToSpending)
}

export function getSpendingSummary(deploymentId: string): SpendingSummary {
  const row = stmtGetSpendingSummary.get(deploymentId) as {
    total_spent: number | null
    total_funded: number | null
    tx_count: number
  } | undefined
  return {
    totalSpent: row?.total_spent ?? 0,
    totalFunded: row?.total_funded ?? 0,
    txCount: row?.tx_count ?? 0,
  }
}

export function getRecentSpending(deploymentId: string, sinceIso: string): SpendingRecord[] {
  const rows = stmtGetRecentSpending.all(deploymentId, sinceIso) as SpendingRow[]
  return rows.map(rowToSpending)
}

// ─── Agent Schedules ─────────────────────────────────
export type AgentSchedule = {
  id: string
  deploymentId: string
  cronExpression: string
  prompt: string
  description: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ScheduleExecution = {
  id: number
  scheduleId: string
  deploymentId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  resultSummary: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
}

type ScheduleRow = {
  id: string
  deployment_id: string
  cron_expression: string
  prompt: string
  description: string
  enabled: number
  created_at: string
  updated_at: string
}

type ScheduleExecRow = {
  id: number
  schedule_id: string
  deployment_id: string
  status: string
  result_summary: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
}

function rowToSchedule(row: ScheduleRow): AgentSchedule {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    cronExpression: row.cron_expression,
    prompt: row.prompt,
    description: row.description,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToExecution(row: ScheduleExecRow): ScheduleExecution {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    deploymentId: row.deployment_id,
    status: row.status as ScheduleExecution['status'],
    resultSummary: row.result_summary,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

const stmtGetSchedulesByAgent = db.prepare(
  'SELECT * FROM agent_schedules WHERE deployment_id = ? ORDER BY created_at ASC',
)
const stmtGetAllEnabledSchedules = db.prepare(
  'SELECT * FROM agent_schedules WHERE enabled = 1',
)
const stmtGetSchedule = db.prepare('SELECT * FROM agent_schedules WHERE id = ?')
const stmtInsertSchedule = db.prepare(
  `INSERT INTO agent_schedules (id, deployment_id, cron_expression, prompt, description, enabled)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const stmtUpdateSchedule = db.prepare(
  `UPDATE agent_schedules SET cron_expression = ?, prompt = ?, description = ?, enabled = ?, updated_at = datetime('now')
   WHERE id = ?`,
)
const stmtDeleteSchedule = db.prepare('DELETE FROM agent_schedules WHERE id = ?')

const stmtInsertExecution = db.prepare(
  `INSERT INTO schedule_executions (schedule_id, deployment_id, status, started_at)
   VALUES (?, ?, ?, ?)`,
)
const stmtUpdateExecution = db.prepare(
  `UPDATE schedule_executions SET status = ?, result_summary = ?, error_message = ?, completed_at = ?
   WHERE id = ?`,
)
const stmtGetExecutions = db.prepare(
  'SELECT * FROM schedule_executions WHERE schedule_id = ? ORDER BY id DESC LIMIT ?',
)

export function getSchedulesByAgent(deploymentId: string): AgentSchedule[] {
  return (stmtGetSchedulesByAgent.all(deploymentId) as ScheduleRow[]).map(rowToSchedule)
}

export function getAllEnabledSchedules(): AgentSchedule[] {
  return (stmtGetAllEnabledSchedules.all() as ScheduleRow[]).map(rowToSchedule)
}

export function getSchedule(id: string): AgentSchedule | null {
  const row = stmtGetSchedule.get(id) as ScheduleRow | undefined
  return row ? rowToSchedule(row) : null
}

export function insertSchedule(schedule: AgentSchedule): void {
  stmtInsertSchedule.run(
    schedule.id, schedule.deploymentId, schedule.cronExpression,
    schedule.prompt, schedule.description, schedule.enabled ? 1 : 0,
  )
}

export function updateSchedule(id: string, fields: Partial<Pick<AgentSchedule, 'cronExpression' | 'prompt' | 'description' | 'enabled'>>): void {
  const existing = getSchedule(id)
  if (!existing) return
  stmtUpdateSchedule.run(
    fields.cronExpression ?? existing.cronExpression,
    fields.prompt ?? existing.prompt,
    fields.description ?? existing.description,
    (fields.enabled ?? existing.enabled) ? 1 : 0,
    id,
  )
}

export function deleteSchedule(id: string): void {
  stmtDeleteSchedule.run(id)
}

export function insertScheduleExecution(scheduleId: string, deploymentId: string): number {
  const result = stmtInsertExecution.run(scheduleId, deploymentId, 'running', new Date().toISOString())
  return Number(result.lastInsertRowid)
}

export function updateScheduleExecution(
  id: number,
  status: 'completed' | 'failed' | 'cap_exceeded',
  resultSummary: string | null,
  errorMessage: string | null,
): void {
  stmtUpdateExecution.run(status, resultSummary, errorMessage, new Date().toISOString(), id)
}

export function getScheduleExecutions(scheduleId: string, limit = 20): ScheduleExecution[] {
  return (stmtGetExecutions.all(scheduleId, limit) as ScheduleExecRow[]).map(rowToExecution)
}

// ─── Event Triggers ──────────────────────────────────
export type EventTrigger = {
  id: string
  deploymentId: string
  eventType: 'hbar_inflow' | 'hcs_message' | 'token_transfer'
  config: Record<string, unknown>
  promptTemplate: string
  enabled: boolean
  lastCheckedAt: string | null
  lastTriggeredAt: string | null
  createdAt: string
}

type TriggerRow = {
  id: string
  deployment_id: string
  event_type: string
  config: string
  prompt_template: string
  enabled: number
  last_checked_at: string | null
  last_triggered_at: string | null
  created_at: string
}

function rowToTrigger(row: TriggerRow): EventTrigger {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    eventType: row.event_type as EventTrigger['eventType'],
    config: safeJsonParse<Record<string, unknown>>(row.config, {}),
    promptTemplate: row.prompt_template,
    enabled: row.enabled === 1,
    lastCheckedAt: row.last_checked_at,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
  }
}

const stmtGetTriggersByAgent = db.prepare(
  'SELECT * FROM event_triggers WHERE deployment_id = ? ORDER BY created_at ASC',
)
const stmtGetAllEnabledTriggers = db.prepare(
  'SELECT * FROM event_triggers WHERE enabled = 1',
)
const stmtGetTrigger = db.prepare('SELECT * FROM event_triggers WHERE id = ?')
const stmtInsertTrigger = db.prepare(
  `INSERT INTO event_triggers (id, deployment_id, event_type, config, prompt_template, enabled)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const stmtUpdateTrigger = db.prepare(
  `UPDATE event_triggers SET event_type = ?, config = ?, prompt_template = ?, enabled = ?
   WHERE id = ?`,
)
const stmtDeleteTrigger = db.prepare('DELETE FROM event_triggers WHERE id = ?')
const stmtUpdateTriggerChecked = db.prepare(
  `UPDATE event_triggers SET last_checked_at = ? WHERE id = ?`,
)
const stmtUpdateTriggerTriggered = db.prepare(
  `UPDATE event_triggers SET last_triggered_at = ? WHERE id = ?`,
)

export function getTriggersByAgent(deploymentId: string): EventTrigger[] {
  return (stmtGetTriggersByAgent.all(deploymentId) as TriggerRow[]).map(rowToTrigger)
}

export function getAllEnabledTriggers(): EventTrigger[] {
  return (stmtGetAllEnabledTriggers.all() as TriggerRow[]).map(rowToTrigger)
}

export function getTrigger(id: string): EventTrigger | null {
  const row = stmtGetTrigger.get(id) as TriggerRow | undefined
  return row ? rowToTrigger(row) : null
}

export function insertTrigger(trigger: EventTrigger): void {
  stmtInsertTrigger.run(
    trigger.id, trigger.deploymentId, trigger.eventType,
    JSON.stringify(trigger.config), trigger.promptTemplate, trigger.enabled ? 1 : 0,
  )
}

export function updateTriggerFields(id: string, fields: Partial<Pick<EventTrigger, 'eventType' | 'config' | 'promptTemplate' | 'enabled'>>): void {
  const existing = getTrigger(id)
  if (!existing) return
  stmtUpdateTrigger.run(
    fields.eventType ?? existing.eventType,
    JSON.stringify(fields.config ?? existing.config),
    fields.promptTemplate ?? existing.promptTemplate,
    (fields.enabled ?? existing.enabled) ? 1 : 0,
    id,
  )
}

export function deleteTrigger(id: string): void {
  stmtDeleteTrigger.run(id)
}

export function updateTriggerCheckedAt(id: string, iso: string): void {
  stmtUpdateTriggerChecked.run(iso, id)
}

export function updateTriggerTriggeredAt(id: string, iso: string): void {
  stmtUpdateTriggerTriggered.run(iso, id)
}

// ─── Jobs (ERC-8183) ─────────────────────────────────
export type JobRecord = {
  id: string
  jobChainId: number
  clientAgentId: string
  providerAgentId: string
  evaluatorAddress: string | null
  description: string
  budgetHbar: number
  expiredAt: string
  status: 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired'
  deliverable: string | null
  contractId: string | null
  txId: string | null
  createdAt: string
  updatedAt: string
}

type JobRow = {
  id: string
  job_chain_id: number
  client_agent_id: string
  provider_agent_id: string
  evaluator_address: string | null
  description: string
  budget_hbar: number
  expired_at: string
  status: string
  deliverable: string | null
  contract_id: string | null
  tx_id: string | null
  created_at: string
  updated_at: string
}

function rowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    jobChainId: row.job_chain_id,
    clientAgentId: row.client_agent_id,
    providerAgentId: row.provider_agent_id,
    evaluatorAddress: row.evaluator_address,
    description: row.description,
    budgetHbar: row.budget_hbar,
    expiredAt: row.expired_at,
    status: row.status as JobRecord['status'],
    deliverable: row.deliverable,
    contractId: row.contract_id,
    txId: row.tx_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const stmtInsertJob = db.prepare(
  `INSERT INTO jobs (id, job_chain_id, client_agent_id, provider_agent_id, evaluator_address,
    description, budget_hbar, expired_at, status, deliverable, contract_id, tx_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const stmtGetJob = db.prepare('SELECT * FROM jobs WHERE id = ?')
const stmtGetJobsByAgent = db.prepare(
  `SELECT * FROM jobs WHERE client_agent_id = ? OR provider_agent_id = ? ORDER BY created_at DESC`,
)
const stmtUpdateJobStatus = db.prepare(
  `UPDATE jobs SET status = ?, deliverable = ?, tx_id = ?, updated_at = datetime('now') WHERE id = ?`,
)

export function insertJob(job: JobRecord): void {
  stmtInsertJob.run(
    job.id, job.jobChainId, job.clientAgentId, job.providerAgentId,
    job.evaluatorAddress, job.description, job.budgetHbar, job.expiredAt,
    job.status, job.deliverable, job.contractId, job.txId,
  )
}

export function getJob(id: string): JobRecord | null {
  const row = stmtGetJob.get(id) as JobRow | undefined
  return row ? rowToJob(row) : null
}

export function getJobsByAgent(agentId: string): JobRecord[] {
  const rows = stmtGetJobsByAgent.all(agentId, agentId) as JobRow[]
  return rows.map(rowToJob)
}

export function updateJobStatus(
  id: string,
  status: JobRecord['status'],
  deliverable?: string | null,
  txId?: string | null,
): void {
  const existing = getJob(id)
  if (!existing) return
  stmtUpdateJobStatus.run(
    status,
    deliverable ?? existing.deliverable,
    txId ?? existing.txId,
    id,
  )
}

export function getJobsByUser(userId: string): JobRecord[] {
  const stmt = db.prepare(
    `SELECT DISTINCT j.* FROM jobs j
     INNER JOIN deployments d ON (j.client_agent_id = d.id OR j.provider_agent_id = d.id)
     WHERE d.user_id = ?
     ORDER BY j.created_at DESC`,
  )
  const rows = stmt.all(userId) as JobRow[]
  return rows.map(rowToJob)
}

export function clearJobsByUser(userId: string): void {
  db.prepare(
    `DELETE FROM jobs WHERE client_agent_id IN (SELECT id FROM deployments WHERE user_id = ?)
     OR provider_agent_id IN (SELECT id FROM deployments WHERE user_id = ?)`,
  ).run(userId, userId)
}

// ─── JSON Migration ──────────────────────────────────
export function migrateFromJson(): void {
  if (!fs.existsSync(OLD_JSON)) return

  try {
    const raw = fs.readFileSync(OLD_JSON, 'utf-8')
    const entries = JSON.parse(raw) as Record<string, Record<string, unknown>>
    let migrated = 0

    const tx = db.transaction(() => {
      for (const [id, record] of Object.entries(entries)) {
        // Skip if already in db
        if (getDeployment(id)) continue

        const deployment: DeploymentRecord = {
          id,
          userId: 'legacy',
          templateId: String(record.templateId ?? ''),
          name: String(record.name ?? ''),
          room: String(record.room ?? ''),
          guardrail: String(record.guardrail ?? ''),
          vaultProtected: Boolean(record.vaultProtected),
          capabilityGroups: (record.capabilityGroups as string[]) ?? [],
          status: String(record.status ?? 'active'),
          lastAction: String(record.lastAction ?? ''),
          executions: Number(record.executions ?? 0),
          createdAt: String(record.createdAt ?? new Date().toISOString()),
          topicId: (record.topicId as string) ?? null,
          contractId: (record.contractId as string) ?? null,
          contractAddress: (record.contractAddress as string) ?? null,
          deploymentTxId: (record.deploymentTxId as string) ?? null,
          vaultCapHbar: Number(record.vaultCapHbar ?? 0),
          agentAccountId: (record.agentAccountId as string) ?? null,
          agentPrivateKey: (record.agentPrivateKey as string) ?? null,
          walletType: String(record.walletType ?? 'platform'),
          kmsKeyId: null,
        }

        insertDeployment(deployment)
        migrated++
      }
    })
    tx()

    if (migrated > 0) {
      fs.renameSync(OLD_JSON, OLD_JSON + '.migrated')
      console.log(`[Aivy] Migrated ${migrated} deployment(s) from JSON to SQLite.`)
    }
  } catch (err) {
    console.error('[Aivy] JSON migration failed:', err)
  }
}

/** Run multiple DB operations atomically */
export function runInTransaction<T>(fn: () => T): T {
  const tx = db.transaction(fn)
  return tx()
}

export function close(): void {
  db.close()
}
