import Phaser from 'phaser'
import type { LiveAgent } from '../types'
import { statusMeta } from '../data'
import { hexToNumber } from './utils'
import { FONT_FAMILY } from './constants'

export interface AgentContainerData {
  id: string
  templateId: string
  nameText: Phaser.GameObjects.Text
  statusText: Phaser.GameObjects.Text
  selectionGlow: Phaser.GameObjects.Graphics
  activityRing: Phaser.GameObjects.Graphics
  activityRingTween: Phaser.Tweens.Tween | null
  sparkles: Phaser.GameObjects.Graphics[]
  hitArea: Phaser.GameObjects.Rectangle
  spriteImage: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle
  lastShownChat: string
  bubbleContainer: Phaser.GameObjects.Container | null
  workGlow: Phaser.GameObjects.Graphics
}

export function createAgentContainer(
  scene: Phaser.Scene,
  agent: LiveAgent,
  worldPos: { x: number; y: number },
  index: number,
): { container: Phaser.GameObjects.Container; data: AgentContainerData } {
  const container = scene.add.container(worldPos.x, worldPos.y)
  container.setDepth(10 + index)

  const colorNum = hexToNumber(agent.color)
  const meta = statusMeta[agent.status]

  // Background card
  const cardBg = scene.add.graphics()
  cardBg.fillStyle(0x0d162d, 0.85)
  cardBg.fillRoundedRect(-38, -45, 76, 90, 10)
  cardBg.lineStyle(2, colorNum, 0.5)
  cardBg.strokeRoundedRect(-38, -45, 76, 90, 10)
  container.add(cardBg)

  // Selection glow (hidden by default)
  const selectionGlow = scene.add.graphics()
  selectionGlow.lineStyle(3, colorNum, 0.9)
  selectionGlow.strokeRoundedRect(-40, -47, 80, 94, 12)
  selectionGlow.setVisible(false)
  container.add(selectionGlow)

  // Agent sprite image
  const textureKey = `agent-${agent.templateId}`
  let spriteImage: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle

  if (scene.textures.exists(textureKey)) {
    spriteImage = scene.add.image(0, -12, textureKey)
    spriteImage.setDisplaySize(40, 40)
  } else {
    // Fallback colored rectangle
    const fallback = scene.add.rectangle(0, -12, 40, 40, colorNum, 0.6)
    fallback.setStrokeStyle(1, colorNum, 1)
    spriteImage = fallback
  }
  container.add(spriteImage)

  // Name label
  const firstName = agent.name.split(' ')[0]
  const nameText = scene.add.text(0, 16, firstName, {
    fontFamily: FONT_FAMILY,
    fontSize: '13px',
    color: '#e8ecf2',
    align: 'center',
  })
  nameText.setOrigin(0.5, 0)
  container.add(nameText)

  // Status badge
  const statusText = scene.add.text(0, 30, meta.label.toUpperCase(), {
    fontFamily: FONT_FAMILY,
    fontSize: '10px',
    color: meta.accent,
    align: 'center',
  })
  statusText.setOrigin(0.5, 0)
  container.add(statusText)

  // Work glow (behind everything, pulsing when active)
  const workGlow = scene.add.graphics()
  workGlow.fillStyle(colorNum, 0.15)
  workGlow.fillCircle(0, 0, 50)
  workGlow.setVisible(false)
  workGlow.setAlpha(0)
  container.addAt(workGlow, 0) // behind card

  // Activity ring (pulsing circle when executing)
  const activityRing = scene.add.graphics()
  activityRing.lineStyle(2, 0x5ad6b5, 0.8)
  activityRing.strokeCircle(0, 0, 48)
  activityRing.setVisible(false)
  container.add(activityRing)

  // Sparkle particles (3 small dots)
  const sparkles: Phaser.GameObjects.Graphics[] = []
  for (let i = 0; i < 3; i++) {
    const sparkle = scene.add.graphics()
    sparkle.fillStyle(colorNum, 0.8)
    sparkle.fillCircle(0, 0, 3)
    sparkle.setVisible(false)
    sparkle.setAlpha(0)
    container.add(sparkle)
    sparkles.push(sparkle)
  }

  // Interactive hit area (invisible rectangle covering the card)
  const hitArea = scene.add.rectangle(0, 0, 76, 90, 0x000000, 0)
  hitArea.setInteractive({ useHandCursor: true })
  container.add(hitArea)

  const data: AgentContainerData = {
    id: agent.id,
    templateId: agent.templateId,
    nameText,
    statusText,
    selectionGlow,
    activityRing,
    activityRingTween: null,
    sparkles,
    hitArea,
    spriteImage,
    lastShownChat: '',
    bubbleContainer: null,
    workGlow,
  }

  return { container, data }
}
