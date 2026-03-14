import { describe, it, expect, afterEach } from 'vitest'
import {
  isAgentRunning,
  acquireAgentLock,
  releaseAgentLock,
  startSchedule,
  stopSchedule,
  stopAllSchedules,
  isScheduleActive,
  validateCron,
} from '../../server/scheduler'

afterEach(() => {
  stopAllSchedules()
})

// ─── Agent Lock ───────────────────────────────────────────
describe('agent lock', () => {
  it('starts with no agents running', () => {
    expect(isAgentRunning('agent-1')).toBe(false)
  })

  it('acquireAgentLock returns true on first call', () => {
    expect(acquireAgentLock('agent-1')).toBe(true)
    expect(isAgentRunning('agent-1')).toBe(true)
    releaseAgentLock('agent-1')
  })

  it('acquireAgentLock returns false if already locked', () => {
    acquireAgentLock('agent-2')
    expect(acquireAgentLock('agent-2')).toBe(false)
    releaseAgentLock('agent-2')
  })

  it('releaseAgentLock frees the lock', () => {
    acquireAgentLock('agent-3')
    releaseAgentLock('agent-3')
    expect(isAgentRunning('agent-3')).toBe(false)
    expect(acquireAgentLock('agent-3')).toBe(true)
    releaseAgentLock('agent-3')
  })

  it('different agents have independent locks', () => {
    acquireAgentLock('a')
    acquireAgentLock('b')
    expect(isAgentRunning('a')).toBe(true)
    expect(isAgentRunning('b')).toBe(true)
    releaseAgentLock('a')
    expect(isAgentRunning('a')).toBe(false)
    expect(isAgentRunning('b')).toBe(true)
    releaseAgentLock('b')
  })
})

// ─── Schedule Management ──────────────────────────────────
describe('schedule management', () => {
  it('startSchedule makes the schedule active', () => {
    startSchedule('sched-1', '*/5 * * * *', () => {})
    expect(isScheduleActive('sched-1')).toBe(true)
  })

  it('stopSchedule deactivates a schedule', () => {
    startSchedule('sched-2', '*/5 * * * *', () => {})
    stopSchedule('sched-2')
    expect(isScheduleActive('sched-2')).toBe(false)
  })

  it('stopSchedule is safe for non-existent id', () => {
    expect(() => stopSchedule('nonexistent')).not.toThrow()
  })

  it('startSchedule replaces existing schedule with same id', () => {
    let counter = 0
    startSchedule('sched-3', '*/5 * * * *', () => { counter += 1 })
    startSchedule('sched-3', '*/10 * * * *', () => { counter += 10 })
    expect(isScheduleActive('sched-3')).toBe(true)
  })

  it('stopAllSchedules clears all', () => {
    startSchedule('a', '*/5 * * * *', () => {})
    startSchedule('b', '*/5 * * * *', () => {})
    startSchedule('c', '*/5 * * * *', () => {})
    stopAllSchedules()
    expect(isScheduleActive('a')).toBe(false)
    expect(isScheduleActive('b')).toBe(false)
    expect(isScheduleActive('c')).toBe(false)
  })
})

// ─── Cron Validation ──────────────────────────────────────
describe('validateCron', () => {
  it('accepts standard cron expressions', () => {
    expect(validateCron('* * * * *')).toBe(true)
    expect(validateCron('0 9 * * 1-5')).toBe(true)
    expect(validateCron('*/5 * * * *')).toBe(true)
    expect(validateCron('30 8 * * 1')).toBe(true)
    expect(validateCron('0 0 1 * *')).toBe(true)
  })

  it('rejects invalid cron expressions', () => {
    expect(validateCron('not-a-cron')).toBe(false)
    expect(validateCron('60 * * * *')).toBe(false)
    expect(validateCron('')).toBe(false)
    expect(validateCron('* *')).toBe(false)
  })
})
