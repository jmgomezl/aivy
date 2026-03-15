import Phaser from 'phaser'
import {
  ROOMS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  FLOOR_COLOR,
  GRID_ALPHA,
  GRID_SPACING,
  ROOM_RADIUS,
  FONT_FAMILY,
  WALL_COLOR,
  WALL_THICKNESS,
  DOOR_WIDTH,
  DOORS,
  FLOOR_TINTS,
} from './constants'
import {
  drawLaunchBay,
  drawStrategyPit,
  drawForumDeck,
  drawWarRoom,
  type AnimRefs,
} from './roomRenderers'

/**
 * OfficeScene — Rich background Phaser scene.
 * Draws rooms with walls, doors, floor patterns, themed furniture,
 * and ambient animations (LED blinks, screen pulses, scan lines, vault dial).
 * Agent rendering is handled by React overlays.
 */
export class OfficeScene extends Phaser.Scene {
  private allAnimRefs: AnimRefs[] = []

  constructor() {
    super({ key: 'OfficeScene' })
  }

  preload() {
    // No sprites to load — agents are rendered by React
  }

  create() {
    // 1. Floor fills with room-specific tint
    this.drawFloors()

    // 2. Subtle grid lines
    this.drawGridLines()

    // 3. Room glow pulses (vignette)
    this.drawRoomGlows()

    // 4. Walls
    this.drawWalls()

    // 5. Doors (overdraw walls)
    this.drawDoors()

    // 6. Room furniture
    this.drawFurniture()

    // 7. Ambient particles
    this.drawAmbientParticles()

    // 8. Room labels (on top of walls)
    this.drawLabels()

    // 9. Setup animations
    this.setupAnimations()

    // 10. Emit ready event for the React wrapper
    this.game.events.emit('sceneReady', this)
  }

  /* ─── Floor Fills ─────────────────────────────────── */

  private drawFloors() {
    for (const room of ROOMS) {
      const floor = this.add.graphics()
      floor.fillStyle(FLOOR_COLOR, 1)
      floor.fillRoundedRect(room.x, room.y, room.w, room.h, ROOM_RADIUS)
      floor.setDepth(0)

      // Subtle color tint overlay
      const tint = FLOOR_TINTS[room.name]
      if (tint) {
        const overlay = this.add.graphics()
        overlay.fillStyle(tint, 0.03)
        overlay.fillRoundedRect(room.x, room.y, room.w, room.h, ROOM_RADIUS)
        overlay.setDepth(0)
      }
    }
  }

  /* ─── Grid Lines ──────────────────────────────────── */

  private drawGridLines() {
    const grid = this.add.graphics()
    grid.lineStyle(1, 0x5ad6b5, GRID_ALPHA)
    grid.setDepth(0)

    for (let x = 0; x <= WORLD_WIDTH; x += GRID_SPACING) {
      grid.lineBetween(x, 0, x, WORLD_HEIGHT)
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SPACING) {
      grid.lineBetween(0, y, WORLD_WIDTH, y)
    }
  }

  /* ─── Room Glow (pulsing vignette) ────────────────── */

  private drawRoomGlows() {
    for (const room of ROOMS) {
      // 3 concentric layers at decreasing alpha for vignette effect
      for (let i = 0; i < 3; i++) {
        const inset = i * 15
        const glow = this.add.graphics()
        glow.fillStyle(room.color, 0.04 - i * 0.01)
        glow.fillRoundedRect(
          room.x + inset, room.y + inset,
          room.w - inset * 2, room.h - inset * 2,
          ROOM_RADIUS,
        )
        glow.setAlpha(0.3)
        glow.setDepth(0)

        this.tweens.add({
          targets: glow,
          alpha: { from: 0.15, to: 0.5 },
          duration: 3000 + Math.random() * 2000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: Math.random() * 2000 + i * 500,
        })
      }
    }
  }

  /* ─── Walls ───────────────────────────────────────── */

  private drawWalls() {
    const W = WALL_THICKNESS

    for (const room of ROOMS) {
      const wall = this.add.graphics()
      wall.fillStyle(WALL_COLOR, 0.95)
      wall.setDepth(3)

      // Top wall
      wall.fillRect(room.x, room.y, room.w, W)
      // Bottom wall
      wall.fillRect(room.x, room.y + room.h - W, room.w, W)
      // Left wall
      wall.fillRect(room.x, room.y, W, room.h)
      // Right wall
      wall.fillRect(room.x + room.w - W, room.y, W, room.h)

      // Inner edge highlight (1px)
      const edge = this.add.graphics()
      edge.lineStyle(1, 0x2a3a5e, 0.3)
      edge.setDepth(3)
      edge.strokeRect(room.x + W, room.y + W, room.w - W * 2, room.h - W * 2)
    }
  }

  /* ─── Doors ───────────────────────────────────────── */

  private drawDoors() {
    const W = WALL_THICKNESS
    const halfDoor = DOOR_WIDTH / 2

    for (const door of DOORS) {
      const doorG = this.add.graphics()
      doorG.setDepth(4)

      if (door.orientation === 'v') {
        // Vertical wall: cut a horizontal gap
        doorG.fillStyle(FLOOR_COLOR, 1)
        doorG.fillRect(door.cx - W / 2 - 2, door.cy - halfDoor, W + 4, DOOR_WIDTH)

        // Door frame accent lines (bright + thick)
        const frame = this.add.graphics()
        frame.lineStyle(2.5, door.color, 0.6)
        frame.setDepth(4)
        frame.lineBetween(door.cx - W - 2, door.cy - halfDoor, door.cx + W + 2, door.cy - halfDoor)
        frame.lineBetween(door.cx - W - 2, door.cy + halfDoor, door.cx + W + 2, door.cy + halfDoor)

        // Corner dots (bigger)
        const dots = this.add.graphics()
        dots.fillStyle(door.color, 0.7)
        dots.setDepth(4)
        dots.fillCircle(door.cx, door.cy - halfDoor, 4)
        dots.fillCircle(door.cx, door.cy + halfDoor, 4)
      } else {
        // Horizontal wall: cut a vertical gap
        doorG.fillStyle(FLOOR_COLOR, 1)
        doorG.fillRect(door.cx - halfDoor, door.cy - W / 2 - 2, DOOR_WIDTH, W + 4)

        // Door frame accent lines (bright + thick)
        const frame = this.add.graphics()
        frame.lineStyle(2.5, door.color, 0.6)
        frame.setDepth(4)
        frame.lineBetween(door.cx - halfDoor, door.cy - W - 2, door.cx - halfDoor, door.cy + W + 2)
        frame.lineBetween(door.cx + halfDoor, door.cy - W - 2, door.cx + halfDoor, door.cy + W + 2)

        // Corner dots (bigger)
        const dots = this.add.graphics()
        dots.fillStyle(door.color, 0.7)
        dots.setDepth(4)
        dots.fillCircle(door.cx - halfDoor, door.cy, 4)
        dots.fillCircle(door.cx + halfDoor, door.cy, 4)
      }
    }
  }

  /* ─── Room Furniture ──────────────────────────────── */

  private drawFurniture() {
    const roomRenderers: Record<string, (scene: Phaser.Scene, room: typeof ROOMS[number]) => AnimRefs> = {
      'Launch Bay': drawLaunchBay,
      'Strategy Pit': drawStrategyPit,
      'Forum Deck': drawForumDeck,
      'War Room': drawWarRoom,
    }

    for (const room of ROOMS) {
      const renderer = roomRenderers[room.name]
      if (renderer) {
        const refs = renderer(this, room)
        this.allAnimRefs.push(refs)
      }
    }
  }

  /* ─── Room Labels ─────────────────────────────────── */

  private drawLabels() {
    for (const room of ROOMS) {
      const labelX = room.x + WALL_THICKNESS + 8
      const labelY = room.y + WALL_THICKNESS + 6

      const label = this.add.text(labelX, labelY, room.name, {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        color: '#e8ecf2',
      })
      label.setAlpha(0.7)
      label.setDepth(5)

      const blurb = this.add.text(labelX, labelY + 18, room.blurb, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        color: '#8390ad',
      })
      blurb.setAlpha(0.6)
      blurb.setDepth(5)
    }
  }

  /* ─── Ambient Particles ──────────────────────────── */

  private drawAmbientParticles() {
    for (const room of ROOMS) {
      for (let i = 0; i < 6; i++) {
        const dot = this.add.graphics()
        dot.fillStyle(room.color, 0.2)
        dot.fillCircle(0, 0, 1 + Math.random() * 1)
        const startX = room.x + 40 + Math.random() * (room.w - 80)
        const startY = room.y + 40 + Math.random() * (room.h - 80)
        dot.setPosition(startX, startY)
        dot.setDepth(0)
        dot.setAlpha(0)

        this.tweens.add({
          targets: dot,
          alpha: { from: 0, to: 0.35 + Math.random() * 0.15 },
          x: startX + (Math.random() - 0.5) * 50,
          y: startY - 15 - Math.random() * 30,
          duration: 6000 + Math.random() * 6000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: Math.random() * 6000,
        })
      }
    }
  }

  /* ─── Animations ──────────────────────────────────── */

  private setupAnimations() {
    for (const refs of this.allAnimRefs) {
      // LED blinks: staggered random alpha oscillation
      for (const led of refs.leds) {
        this.tweens.add({
          targets: led,
          alpha: { from: 0.3, to: 1.0 },
          duration: 800 + Math.random() * 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: Math.random() * 2000,
        })
      }

      // Screen glow pulses
      for (const screen of refs.screens) {
        this.tweens.add({
          targets: screen,
          alpha: { from: 0.6, to: 1.0 },
          duration: 2000 + Math.random() * 1500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: Math.random() * 1500,
        })
      }

      // Scan line sweep (War Room monitors)
      if (refs.scanLine) {
        const monGridY = 70 // relative to room top
        const monH = 50 * 2 + 8 // 2 rows of monitors
        const room = ROOMS[3] // War Room
        const startY = room.y + monGridY
        const endY = startY + monH

        this.tweens.add({
          targets: refs.scanLine,
          y: { from: startY, to: endY },
          duration: 3000,
          repeat: -1,
          ease: 'Linear',
        })
      }

      // Vault dial orbiting dot
      if (refs.vaultDial) {
        const room = ROOMS[3] // War Room
        const vaultX = room.x + 80
        const vaultY = room.y + room.h * 0.5
        const radius = 40

        this.tweens.add({
          targets: { angle: 0 },
          angle: Math.PI * 2,
          duration: 8000,
          repeat: -1,
          ease: 'Linear',
          onUpdate: (_tween, target) => {
            if (refs.vaultDial) {
              refs.vaultDial.setPosition(
                vaultX + Math.cos(target.angle) * radius,
                vaultY + Math.sin(target.angle) * radius,
              )
            }
          },
        })
      }

      // Chart line y-oscillation (Strategy Pit — simulates live data)
      if (refs.chartLines) {
        for (const chart of refs.chartLines) {
          this.tweens.add({
            targets: chart,
            y: { from: -3, to: 3 },
            duration: 3000 + Math.random() * 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Math.random() * 3000,
          })
        }
      }

      // Log panel scroll (War Room — simulates live audit feed)
      if (refs.logPanel) {
        const panel = refs.logPanel
        this.tweens.add({
          targets: panel.graphics,
          alpha: { from: 1, to: 0.3 },
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          hold: 4000,  // stay visible for 4s between flashes
          repeatDelay: 2000,
        })
      }
    }
  }
}
