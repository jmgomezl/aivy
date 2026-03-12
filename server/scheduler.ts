import cron from 'node-cron'

type ScheduledTask = {
  cronTask: cron.ScheduledTask
  runner: () => void | Promise<void>
}

const activeTasks = new Map<string, ScheduledTask>()

// Per-agent lock to prevent concurrent schedule/trigger executions
const runningAgents = new Set<string>()

export function isAgentRunning(deploymentId: string): boolean {
  return runningAgents.has(deploymentId)
}

export function acquireAgentLock(deploymentId: string): boolean {
  if (runningAgents.has(deploymentId)) return false
  runningAgents.add(deploymentId)
  return true
}

export function releaseAgentLock(deploymentId: string): void {
  runningAgents.delete(deploymentId)
}

export function startSchedule(
  id: string,
  cronExpression: string,
  runner: () => void | Promise<void>,
): void {
  // Stop existing if any
  stopSchedule(id)

  const cronTask = cron.schedule(cronExpression, async () => {
    try {
      await runner()
    } catch (err) {
      console.error(`[Scheduler] Error running schedule ${id}:`, err)
    }
  })

  activeTasks.set(id, { cronTask, runner })
  console.log(`[Scheduler] Started schedule ${id} (${cronExpression})`)
}

export function stopSchedule(id: string): void {
  const task = activeTasks.get(id)
  if (task) {
    task.cronTask.stop()
    activeTasks.delete(id)
    console.log(`[Scheduler] Stopped schedule ${id}`)
  }
}

export function stopAllSchedules(): void {
  for (const [id, task] of activeTasks) {
    task.cronTask.stop()
    console.log(`[Scheduler] Stopped schedule ${id}`)
  }
  activeTasks.clear()
}

export function isScheduleActive(id: string): boolean {
  return activeTasks.has(id)
}

export function validateCron(expression: string): boolean {
  return cron.validate(expression)
}
