import { describe, it, expect } from 'vitest'
import {
  templates,
  roomCards,
  launchWizardByTemplate,
  roomSlots,
  statusMeta,
  toneClass,
  speechBubbles,
  applyLayout,
  emptyStats,
} from '../../src/data'
import type { ServerDeployment } from '../../src/types'

// ─── templates ────────────────────────────────────────────
describe('templates', () => {
  it('has exactly 4 templates', () => {
    expect(templates).toHaveLength(4)
  })

  it('each template has required fields', () => {
    for (const t of templates) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.glyph).toHaveLength(2)
      expect(t.sprite).toBeTruthy()
      expect(t.color).toMatch(/^#/)
      expect(t.room).toBeTruthy()
      expect(t.mission).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.guardrail).toBeTruthy()
    }
  })

  it('template IDs are unique', () => {
    const ids = templates.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes all four expected templates', () => {
    const ids = templates.map(t => t.id)
    expect(ids).toContain('treasury-sentinel')
    expect(ids).toContain('yield-router')
    expect(ids).toContain('compliance-clerk')
    expect(ids).toContain('governance-relay')
  })

  it('each template room maps to a known room', () => {
    const roomNames = roomCards.map(r => r.name)
    for (const t of templates) {
      expect(roomNames).toContain(t.room)
    }
  })
})

// ─── roomCards ─────────────────────────────────────────────
describe('roomCards', () => {
  it('has 4 rooms', () => {
    expect(roomCards).toHaveLength(4)
  })

  it('each room has name, className, and blurb', () => {
    for (const room of roomCards) {
      expect(room.name).toBeTruthy()
      expect(room.className).toBeTruthy()
      expect(room.blurb).toBeTruthy()
    }
  })

  it('room names are unique', () => {
    const names = roomCards.map(r => r.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

// ─── roomSlots ────────────────────────────────────────────
describe('roomSlots', () => {
  it('has entries for all 4 rooms', () => {
    expect(Object.keys(roomSlots)).toHaveLength(4)
    for (const room of roomCards) {
      expect(roomSlots[room.name]).toBeDefined()
    }
  })

  it('each room has 5 position slots', () => {
    for (const [, slots] of Object.entries(roomSlots)) {
      expect(slots).toHaveLength(5)
    }
  })

  it('each slot has x and y coordinates', () => {
    for (const [, slots] of Object.entries(roomSlots)) {
      for (const slot of slots) {
        expect(typeof slot.x).toBe('number')
        expect(typeof slot.y).toBe('number')
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeGreaterThanOrEqual(0)
        expect(slot.x).toBeLessThanOrEqual(100)
        expect(slot.y).toBeLessThanOrEqual(100)
      }
    }
  })
})

// ─── launchWizardByTemplate ───────────────────────────────
describe('launchWizardByTemplate', () => {
  it('has wizard config for every template', () => {
    for (const t of templates) {
      expect(launchWizardByTemplate[t.id]).toBeDefined()
    }
  })

  it('each wizard has title, description, defaults, and fields', () => {
    for (const [, wizard] of Object.entries(launchWizardByTemplate)) {
      expect(wizard.title).toBeTruthy()
      expect(wizard.description).toBeTruthy()
      expect(wizard.defaults).toBeDefined()
      expect(wizard.fields.length).toBeGreaterThan(0)
    }
  })

  it('each wizard field has id, label, and input type', () => {
    for (const [, wizard] of Object.entries(launchWizardByTemplate)) {
      for (const field of wizard.fields) {
        expect(field.id).toBeTruthy()
        expect(field.label).toBeTruthy()
        expect(['text', 'number', 'select', 'textarea']).toContain(field.input)
      }
    }
  })

  it('select fields have options', () => {
    for (const [, wizard] of Object.entries(launchWizardByTemplate)) {
      for (const field of wizard.fields) {
        if (field.input === 'select') {
          expect(field.options).toBeDefined()
          expect(field.options!.length).toBeGreaterThan(0)
          for (const opt of field.options!) {
            expect(opt.label).toBeTruthy()
            expect(opt.value).toBeTruthy()
          }
        }
      }
    }
  })

  it('defaults contain values for all field IDs', () => {
    for (const [, wizard] of Object.entries(launchWizardByTemplate)) {
      for (const field of wizard.fields) {
        expect(wizard.defaults).toHaveProperty(field.id)
      }
    }
  })
})

// ─── statusMeta ───────────────────────────────────────────
describe('statusMeta', () => {
  it('has entries for all statuses', () => {
    const statuses = ['deploying', 'guarded', 'active', 'paused'] as const
    for (const s of statuses) {
      expect(statusMeta[s]).toBeDefined()
      expect(statusMeta[s].label).toBeTruthy()
      expect(statusMeta[s].accent).toMatch(/^#/)
    }
  })
})

// ─── toneClass ────────────────────────────────────────────
describe('toneClass', () => {
  it('maps all tones to CSS classes', () => {
    const tones = ['amber', 'teal', 'blue', 'rose'] as const
    for (const tone of tones) {
      expect(toneClass[tone]).toMatch(/^is-/)
    }
  })
})

// ─── speechBubbles ────────────────────────────────────────
describe('speechBubbles', () => {
  it('has bubbles for each template', () => {
    for (const t of templates) {
      expect(speechBubbles[t.id]).toBeDefined()
      expect(speechBubbles[t.id].length).toBeGreaterThan(0)
    }
  })
})

// ─── emptyStats ───────────────────────────────────────────
describe('emptyStats', () => {
  it('has all zero values', () => {
    expect(emptyStats.connectedAgents).toBe(0)
    expect(emptyStats.safeVaults).toBe(0)
    expect(emptyStats.totalExecutions).toBe(0)
    expect(emptyStats.pendingTransactions).toBe(0)
    expect(emptyStats.hbarSecured).toBe(0)
  })
})

// ─── applyLayout ──────────────────────────────────────────
describe('applyLayout', () => {
  const makeDeploy = (templateId: string, room: string): ServerDeployment => ({
    id: `deploy-${Math.random()}`,
    userId: 'user-1',
    templateId,
    name: 'Test Agent',
    room,
    guardrail: 'test',
    status: 'active',
    topicId: '0.0.1',
    deploymentTxId: '0.0.2@123',
    vaultProtected: false,
    vaultCapHbar: 0,
    contractId: null,
    contractAddress: null,
    agentAccountId: null,
    executions: 0,
    createdAt: new Date().toISOString(),
  })

  it('returns empty array for no deployments', () => {
    expect(applyLayout([])).toEqual([])
  })

  it('adds glyph, sprite, color, mission, x, y to each agent', () => {
    const deployments = [makeDeploy('treasury-sentinel', 'Launch Bay')]
    const result = applyLayout(deployments)
    expect(result).toHaveLength(1)
    expect(result[0].glyph).toBe('TS')
    expect(result[0].color).toBe('#ff9a3c')
    expect(typeof result[0].x).toBe('number')
    expect(typeof result[0].y).toBe('number')
  })

  it('assigns different positions for agents in the same room', () => {
    const deployments = [
      makeDeploy('treasury-sentinel', 'Launch Bay'),
      makeDeploy('treasury-sentinel', 'Launch Bay'),
    ]
    const result = applyLayout(deployments)
    expect(result[0].x).not.toBe(result[1].x)
  })

  it('falls back to center position for unknown rooms', () => {
    const deployments = [makeDeploy('treasury-sentinel', 'Unknown Room')]
    const result = applyLayout(deployments)
    expect(result[0].x).toBe(50)
    expect(result[0].y).toBe(50)
  })

  it('falls back to first template for unknown templateId', () => {
    const deployments = [makeDeploy('nonexistent-template', 'Launch Bay')]
    const result = applyLayout(deployments)
    // Falls back to templates[0] which is treasury-sentinel
    expect(result[0].glyph).toBe('TS')
  })
})
