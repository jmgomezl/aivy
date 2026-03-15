import { WORLD_WIDTH, WORLD_HEIGHT } from './constants'

/** Convert LiveAgent percentage coords (0-100) to Phaser world pixels */
export function liveToWorld(liveX: number, liveY: number): { x: number; y: number } {
  return {
    x: (liveX / 100) * WORLD_WIDTH,
    y: (liveY / 100) * WORLD_HEIGHT,
  }
}

/** Draw a dashed line on a Phaser Graphics object */
export function drawDashedLine(
  graphics: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLen = 8,
  gapLen = 4,
) {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  const steps = Math.floor(dist / (dashLen + gapLen))
  const ux = dx / dist
  const uy = dy / dist

  for (let i = 0; i < steps; i++) {
    const sx = x1 + (dashLen + gapLen) * i * ux
    const sy = y1 + (dashLen + gapLen) * i * uy
    const ex = sx + dashLen * ux
    const ey = sy + dashLen * uy
    graphics.lineBetween(sx, sy, ex, ey)
  }
}

/** Hex color string "#ff9a3c" → 0xff9a3c */
export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/** Truncate text with ellipsis */
export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text
}
