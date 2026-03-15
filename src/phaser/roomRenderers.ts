import Phaser from 'phaser'
import {
  SCREEN_GLOW,
  SCREEN_BODY,
  LED_GREEN,
  LED_ORANGE,
  LED_RED,
  RACK_COLOR,
  DESK_COLOR,
  TABLE_COLOR,
  PIPE_COLOR,
  type RoomDef,
} from './constants'

/* ─── Shared Utilities ──────────────────────────────── */

export interface AnimRefs {
  leds: Phaser.GameObjects.Graphics[]
  screens: Phaser.GameObjects.Graphics[]
  scanLine?: Phaser.GameObjects.Graphics
  vaultDial?: Phaser.GameObjects.Graphics
  /** Chart polyline graphics for subtle y-oscillation */
  chartLines?: Phaser.GameObjects.Graphics[]
  /** Log line graphics for scroll/refresh animation */
  logPanel?: { graphics: Phaser.GameObjects.Graphics; baseY: number }
}

function drawScreen(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  glowColor = SCREEN_GLOW,
  depth = 2,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  // Body
  g.fillStyle(SCREEN_BODY, 1)
  g.fillRoundedRect(x, y, w, h, 6)
  // Glow border (thicker, brighter)
  g.lineStyle(2.5, glowColor, 0.7)
  g.strokeRoundedRect(x, y, w, h, 6)
  g.setDepth(depth)
  g.setAlpha(0.85)
  return g
}

function drawLED(
  scene: Phaser.Scene,
  x: number, y: number,
  color: number,
  depth = 2,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  // Glow halo behind LED
  g.fillStyle(color, 0.15)
  g.fillCircle(x, y, 6)
  // LED dot (bigger)
  g.fillStyle(color, 1)
  g.fillCircle(x, y, 3.5)
  g.setDepth(depth)
  g.setAlpha(0.85)
  return g
}

/* ─── Launch Bay — Mission Control ──────────────────── */

export function drawLaunchBay(scene: Phaser.Scene, room: RoomDef): AnimRefs {
  const refs: AnimRefs = { leds: [], screens: [] }
  const rx = room.x
  const ry = room.y

  // ── Server Racks (left wall) ──
  for (let i = 0; i < 2; i++) {
    const rackX = rx + 20
    const rackY = ry + 70 + i * 140
    const rackW = 50
    const rackH = 120
    const rack = scene.add.graphics()
    rack.fillStyle(RACK_COLOR, 0.9)
    rack.fillRoundedRect(rackX, rackY, rackW, rackH, 4)
    // Shelf dividers
    for (let s = 1; s <= 3; s++) {
      rack.lineStyle(1, 0x2a3452, 0.5)
      rack.lineBetween(rackX + 4, rackY + s * 28, rackX + rackW - 4, rackY + s * 28)
    }
    rack.setDepth(1)

    // LEDs on each shelf
    const ledColors = [LED_GREEN, LED_GREEN, LED_ORANGE, LED_GREEN, LED_RED]
    for (let s = 0; s < 4; s++) {
      for (let l = 0; l < 3; l++) {
        const color = ledColors[(s * 3 + l) % ledColors.length]
        const led = drawLED(scene, rackX + 14 + l * 12, rackY + 10 + s * 28, color)
        refs.leds.push(led)
      }
    }
  }

  // ── Command Terminal (top-right area) ──
  const termX = rx + 380
  const termY = ry + 70
  const termScreen = drawScreen(scene, termX, termY, 150, 90, SCREEN_GLOW)
  refs.screens.push(termScreen)

  // Fake command lines on the terminal
  const lines = scene.add.graphics()
  lines.setDepth(2)
  const lineColor = 0x00d4ff
  for (let i = 0; i < 5; i++) {
    const lineW = 40 + Math.random() * 80
    lines.fillStyle(lineColor, 0.15 + Math.random() * 0.1)
    lines.fillRect(termX + 10, termY + 12 + i * 14, lineW, 6)
  }

  // ── Deployment Status Panel (right area, below terminal) ──
  const statusX = rx + 400
  const statusY = ry + 200
  const statusScreen = drawScreen(scene, statusX, statusY, 120, 60, 0x4ade80)
  refs.screens.push(statusScreen)

  // Status indicators inside
  const statusLines = scene.add.graphics()
  statusLines.setDepth(2)
  for (let i = 0; i < 3; i++) {
    statusLines.fillStyle(LED_GREEN, 0.2)
    statusLines.fillRect(statusX + 10, statusY + 14 + i * 14, 60 + Math.random() * 30, 6)
  }

  // ── Cooling Pipes (bottom-left corner) ──
  const pipes = scene.add.graphics()
  pipes.lineStyle(4, PIPE_COLOR, 0.5)
  pipes.setDepth(1)
  for (let i = 0; i < 3; i++) {
    const px = rx + 22 + i * 18
    const py = ry + room.h - 70
    pipes.lineBetween(px, py, px + 40, py + 50)
  }

  return refs
}

/* ─── Strategy Pit — Trading Floor ──────────────────── */

export function drawStrategyPit(scene: Phaser.Scene, room: RoomDef): AnimRefs {
  const refs: AnimRefs = { leds: [], screens: [], chartLines: [] }
  const rx = room.x
  const ry = room.y

  // ── 3 Trading Monitors (top area) ──
  const monitorConfigs = [
    { ox: 60,  oy: 60,  w: 130, h: 75, chartColor: LED_GREEN },
    { ox: 220, oy: 55,  w: 130, h: 75, chartColor: 0x4ecdc4 },
    { ox: 380, oy: 60,  w: 130, h: 75, chartColor: LED_RED },
  ]

  for (const mc of monitorConfigs) {
    const sx = rx + mc.ox
    const sy = ry + mc.oy
    const screen = drawScreen(scene, sx, sy, mc.w, mc.h, mc.chartColor)
    refs.screens.push(screen)

    // Chart lines (simple polylines)
    const chart = scene.add.graphics()
    chart.lineStyle(2.5, mc.chartColor, 0.6)
    chart.setDepth(2)

    chart.beginPath()
    const points = 8
    for (let p = 0; p <= points; p++) {
      const px = sx + 10 + (p / points) * (mc.w - 20)
      const baseY = sy + mc.h * 0.5
      const amplitude = mc.h * 0.25
      const py = baseY + Math.sin(p * 1.2 + mc.ox * 0.01) * amplitude
      if (p === 0) chart.moveTo(px, py)
      else chart.lineTo(px, py)
    }
    chart.strokePath()
    refs.chartLines!.push(chart)
  }

  // ── Central Analysis Desk ──
  const deskX = rx + 180
  const deskY = ry + 220
  const desk = scene.add.graphics()
  desk.fillStyle(DESK_COLOR, 0.8)
  desk.fillRoundedRect(deskX, deskY, 200, 80, 8)
  desk.lineStyle(1, 0x4ecdc4, 0.2)
  desk.strokeRoundedRect(deskX, deskY, 200, 80, 8)
  desk.setDepth(1)

  // ── Yield Indicator (right side) ──
  const barX = rx + room.w - 55
  const barY = ry + 80
  const barH = 250
  const yieldBar = scene.add.graphics()
  yieldBar.setDepth(1)

  // Background bar
  yieldBar.fillStyle(0x111827, 0.7)
  yieldBar.fillRoundedRect(barX, barY, 20, barH, 4)
  // Fill level (~65%)
  const fillH = barH * 0.65
  yieldBar.fillStyle(0x4ecdc4, 0.4)
  yieldBar.fillRoundedRect(barX, barY + barH - fillH, 20, fillH, 4)
  // Border
  yieldBar.lineStyle(1, 0x4ecdc4, 0.3)
  yieldBar.strokeRoundedRect(barX, barY, 20, barH, 4)

  // Yield label
  const yLabel = scene.add.text(barX - 2, barY - 16, 'YIELD', {
    fontFamily: 'VT323, monospace',
    fontSize: '10px',
    color: '#4ecdc4',
  })
  yLabel.setAlpha(0.5)
  yLabel.setDepth(2)

  return refs
}

/* ─── Forum Deck — Governance Chamber ───────────────── */

export function drawForumDeck(scene: Phaser.Scene, room: RoomDef): AnimRefs {
  const refs: AnimRefs = { leds: [], screens: [] }
  const rx = room.x
  const ry = room.y
  const centerX = rx + room.w * 0.42
  const centerY = ry + room.h * 0.5

  // ── Round Table (center) ──
  const table = scene.add.graphics()
  table.setDepth(1)
  // Outer ring
  table.fillStyle(TABLE_COLOR, 0.8)
  table.fillCircle(centerX, centerY, 65)
  // Inner ring stroke
  table.lineStyle(2, 0x7f95d1, 0.2)
  table.strokeCircle(centerX, centerY, 45)
  // Center dot
  table.fillStyle(0x7f95d1, 0.15)
  table.fillCircle(centerX, centerY, 12)

  // ── 4 Voting Stations (around table) ──
  const stations = [
    { x: centerX, y: centerY - 100 },     // top
    { x: centerX + 100, y: centerY },      // right
    { x: centerX, y: centerY + 100 },      // bottom
    { x: centerX - 100, y: centerY },      // left
  ]

  for (const st of stations) {
    const console = scene.add.graphics()
    console.fillStyle(DESK_COLOR, 0.8)
    console.fillRoundedRect(st.x - 18, st.y - 12, 36, 24, 4)
    console.lineStyle(1, 0x7f95d1, 0.2)
    console.strokeRoundedRect(st.x - 18, st.y - 12, 36, 24, 4)
    console.setDepth(1)

    // Green + Red LED pair
    const greenLed = drawLED(scene, st.x - 6, st.y, LED_GREEN)
    const redLed = drawLED(scene, st.x + 6, st.y, LED_RED)
    refs.leds.push(greenLed, redLed)
  }

  // ── Proposal Display (top-right) ──
  const propX = rx + room.w - 170
  const propY = ry + 70
  const propScreen = drawScreen(scene, propX, propY, 130, 80, 0x7f95d1)
  refs.screens.push(propScreen)

  // Fake text lines
  const textLines = scene.add.graphics()
  textLines.setDepth(2)
  for (let i = 0; i < 4; i++) {
    const lw = 50 + Math.random() * 60
    textLines.fillStyle(0x7f95d1, 0.15)
    textLines.fillRect(propX + 10, propY + 14 + i * 14, lw, 6)
  }

  // ── Timelock Clock (bottom-left) ──
  const clockX = rx + 60
  const clockY = ry + room.h - 80
  const clock = scene.add.graphics()
  clock.setDepth(1)

  // Clock face
  clock.lineStyle(2, 0x7f95d1, 0.3)
  clock.strokeCircle(clockX, clockY, 25)

  // Tick marks (12 positions)
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2
    const innerR = 20
    const outerR = 24
    clock.lineStyle(1, 0x7f95d1, 0.4)
    clock.lineBetween(
      clockX + Math.cos(angle) * innerR,
      clockY + Math.sin(angle) * innerR,
      clockX + Math.cos(angle) * outerR,
      clockY + Math.sin(angle) * outerR,
    )
  }

  // Clock hands
  const hourAngle = Math.PI * 0.25
  const minuteAngle = Math.PI * 1.1
  clock.lineStyle(2, 0x7f95d1, 0.5)
  clock.lineBetween(clockX, clockY, clockX + Math.cos(hourAngle) * 12, clockY + Math.sin(hourAngle) * 12)
  clock.lineStyle(1.5, 0x7f95d1, 0.4)
  clock.lineBetween(clockX, clockY, clockX + Math.cos(minuteAngle) * 18, clockY + Math.sin(minuteAngle) * 18)

  // TIMELOCK label
  const tLabel = scene.add.text(clockX - 28, clockY + 30, 'TIMELOCK', {
    fontFamily: 'VT323, monospace',
    fontSize: '10px',
    color: '#7f95d1',
  })
  tLabel.setAlpha(0.4)
  tLabel.setDepth(2)

  return refs
}

/* ─── War Room — Security Operations ────────────────── */

export function drawWarRoom(scene: Phaser.Scene, room: RoomDef): AnimRefs {
  const refs: AnimRefs = { leds: [], screens: [] }
  const rx = room.x
  const ry = room.y

  // ── Vault Door (left-center) ──
  const vaultX = rx + 80
  const vaultY = ry + room.h * 0.5
  const vault = scene.add.graphics()
  vault.setDepth(1)

  // Outer ring
  vault.lineStyle(3.5, 0xf25f5c, 0.4)
  vault.strokeCircle(vaultX, vaultY, 55)
  // Middle ring
  vault.lineStyle(2.5, 0xf25f5c, 0.3)
  vault.strokeCircle(vaultX, vaultY, 40)
  // Inner ring
  vault.lineStyle(2, 0xf25f5c, 0.2)
  vault.strokeCircle(vaultX, vaultY, 25)

  // Combination dial tick marks (8 positions)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    vault.lineStyle(2.5, 0xf25f5c, 0.45)
    vault.lineBetween(
      vaultX + Math.cos(angle) * 42,
      vaultY + Math.sin(angle) * 42,
      vaultX + Math.cos(angle) * 52,
      vaultY + Math.sin(angle) * 52,
    )
  }

  // Center knob
  vault.fillStyle(0xf25f5c, 0.2)
  vault.fillCircle(vaultX, vaultY, 12)

  // Orbiting dial dot (will be animated)
  const dialDot = scene.add.graphics()
  dialDot.fillStyle(0xf25f5c, 0.9)
  dialDot.fillCircle(0, 0, 4)
  dialDot.setPosition(vaultX + 40, vaultY)
  dialDot.setDepth(2)
  refs.vaultDial = dialDot

  // VAULT label
  const vLabel = scene.add.text(vaultX - 22, vaultY + 62, 'VAULT', {
    fontFamily: 'VT323, monospace',
    fontSize: '12px',
    color: '#f25f5c',
  })
  vLabel.setAlpha(0.4)
  vLabel.setDepth(2)

  // ── Security Monitors (top-right, 2×2 grid) ──
  const monGridX = rx + room.w - 200
  const monGridY = ry + 70
  const monW = 72
  const monH = 50
  const monGap = 8

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const mx = monGridX + c * (monW + monGap)
      const my = monGridY + r * (monH + monGap)
      const screen = drawScreen(scene, mx, my, monW, monH, 0xf25f5c)
      refs.screens.push(screen)
    }
  }

  // Scan line overlay (animated horizontal line sweeping vertically)
  const scanLine = scene.add.graphics()
  scanLine.lineStyle(2.5, 0xf25f5c, 0.45)
  scanLine.lineBetween(monGridX, 0, monGridX + monW * 2 + monGap, 0)
  scanLine.setPosition(0, monGridY + 10)
  scanLine.setDepth(3)
  refs.scanLine = scanLine

  // ── Alarm LEDs (top-left corner) ──
  const alarmLeds = [
    { color: LED_RED, x: rx + 30, y: ry + 70 },
    { color: LED_GREEN, x: rx + 30, y: ry + 82 },
    { color: LED_ORANGE, x: rx + 30, y: ry + 94 },
  ]
  for (const al of alarmLeds) {
    const led = drawLED(scene, al.x, al.y, al.color)
    refs.leds.push(led)
  }

  // ── Audit Log Display (bottom) ──
  const logX = rx + 160
  const logY = ry + room.h - 100
  const logScreen = drawScreen(scene, logX, logY, 360, 60, 0xf25f5c)
  refs.screens.push(logScreen)

  // Fake log lines (tracked for scroll animation)
  const logLines = scene.add.graphics()
  logLines.setDepth(2)
  for (let i = 0; i < 3; i++) {
    // Timestamp block
    logLines.fillStyle(0xf25f5c, 0.12)
    logLines.fillRect(logX + 10, logY + 12 + i * 14, 50, 6)
    // Log text
    logLines.fillStyle(0xf25f5c, 0.10)
    logLines.fillRect(logX + 68, logY + 12 + i * 14, 100 + Math.random() * 150, 6)
  }
  refs.logPanel = { graphics: logLines, baseY: logLines.y }

  return refs
}
