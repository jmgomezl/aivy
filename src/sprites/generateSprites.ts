/**
 * generateSprites.ts — Extracts robot sprites from 0x72 tileset
 *
 * Loads the tileset PNG, extracts 4 IDLE frames per agent,
 * tints them with the agent's theme color, and returns data URLs
 * for CSS background animation.
 *
 * Tileset grid: 16×16 px tiles
 * IDLE frames at x=288,304,320,336 (4 frames per robot row)
 */

import tilesetUrl from '/sprites/robots.png?url'

// ─── Robot row mapping (y position in tileset) ─────────
// Each robot occupies a 16px-tall row in the tileset
const ROBOT_ROWS: Record<string, { y: number; tint: string }> = {
  treasury:   { y: 16,  tint: '#ff9a3c' },  // Row 1: tall bot with orange eyes
  yield:      { y: 32,  tint: '#4ecdc4' },  // Row 2: bot with cyan eyes
  compliance: { y: 48,  tint: '#f25f5c' },  // Row 3: bot with red visor display
  governance: { y: 192, tint: '#7f95d1' },  // Row 12: chunky bot with green eyes
}

const IDLE_X = 288       // x-start of IDLE section in tileset
const FRAME_W = 16       // each frame is 16px wide
const FRAME_H = 16       // each frame is 16px tall
const FRAME_COUNT = 1    // single static frame (no animation = no blinking)
const TINT_STRENGTH = 0.65 // how much color tint to apply (0=none, 1=full)

// ─── Load tileset and extract sprite sheets ────────────
let cache: Record<string, string> | null = null
let loadPromise: Promise<void> | null = null

function loadTileset(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = tilesetUrl
  })
}

/**
 * Extract 4 IDLE frames from the tileset and apply a color tint.
 * Steps:
 *  1. Draw the raw grayscale sprite frames
 *  2. Overlay a semi-transparent color using 'source-atop' compositing
 *     This tints only the opaque pixels, preserving transparency
 *  3. Draw the original sprite again at reduced opacity to bring back detail
 */
function extractSpriteSheet(
  tileset: HTMLImageElement,
  rowY: number,
  tintColor: string,
): string {
  const sheetW = FRAME_COUNT * FRAME_W  // 16px (single frame)
  const canvas = document.createElement('canvas')
  canvas.width = sheetW
  canvas.height = FRAME_H  // 16px
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Step 1: Draw raw sprite frames
  for (let f = 0; f < FRAME_COUNT; f++) {
    ctx.drawImage(
      tileset,
      IDLE_X + f * FRAME_W, rowY,   // source x, y
      FRAME_W, FRAME_H,             // source w, h
      f * FRAME_W, 0,               // dest x, y
      FRAME_W, FRAME_H,             // dest w, h
    )
  }

  // Step 2: Tint — overlay color on opaque pixels only
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = TINT_STRENGTH
  ctx.fillStyle = tintColor
  ctx.fillRect(0, 0, sheetW, FRAME_H)

  // Step 3: Brighten — subtle lift for visibility on dark backgrounds
  ctx.globalAlpha = 0.15
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheetW, FRAME_H)

  // Reset compositing
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1.0

  return canvas.toDataURL('image/png')
}

async function initCache(): Promise<void> {
  if (cache) return
  const tileset = await loadTileset()
  cache = {}
  for (const [key, cfg] of Object.entries(ROBOT_ROWS)) {
    cache[key] = extractSpriteSheet(tileset, cfg.y, cfg.tint)
  }
}

// Start loading immediately on module import
loadPromise = initCache()

// ─── Public API ────────────────────────────────────────

/** Get sprite sheet data URL (returns '' if not loaded yet) */
export function getSpriteSheet(agentType: string): string {
  return cache?.[agentType] || ''
}

/** Ensure sprites are loaded (call once at app start) */
export async function ensureSpritesLoaded(): Promise<void> {
  await loadPromise
}

/** Map agent name → sprite type */
export function agentNameToSpriteType(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('treasury') || n.includes('sentinel')) return 'treasury'
  if (n.includes('yield') || n.includes('router')) return 'yield'
  if (n.includes('governance') || n.includes('relay') || n.includes('gov')) return 'governance'
  if (n.includes('compliance') || n.includes('clerk') || n.includes('audit')) return 'compliance'
  // Fallback: hash the name to pick a type
  const types = Object.keys(ROBOT_ROWS)
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % types.length
  return types[hash]
}
