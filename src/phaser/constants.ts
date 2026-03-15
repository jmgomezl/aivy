/** World and room layout constants for the Phaser office scene */

export const WORLD_WIDTH = 1200
export const WORLD_HEIGHT = 900

export const ROOM_GAP = 20
export const ROOM_RADIUS = 12

export interface RoomDef {
  name: string
  x: number
  y: number
  w: number
  h: number
  color: number
  blurb: string
}

export const ROOMS: readonly RoomDef[] = [
  { name: 'Launch Bay', x: 20, y: 20, w: 570, h: 410, color: 0xff9a3c, blurb: 'Provisioning' },
  { name: 'Strategy Pit', x: 610, y: 20, w: 570, h: 410, color: 0x4ecdc4, blurb: 'Execution' },
  { name: 'Forum Deck', x: 20, y: 450, w: 570, h: 410, color: 0x7f95d1, blurb: 'Approvals' },
  { name: 'War Room', x: 610, y: 450, w: 570, h: 410, color: 0xf25f5c, blurb: 'Vault + audit' },
] as const

export const FLOOR_COLOR = 0x0f1525
export const GRID_ALPHA = 0.03
export const GRID_SPACING = 26

export const AGENT_SPRITE_SCALE = 0.5
export const AGENT_CARD_WIDTH = 76
export const AGENT_CARD_HEIGHT = 90

export const FONT_FAMILY = 'VT323, monospace'
export const ACCENT_TEAL = '#5ad6b5'

/* ─── Wall / Door / Furniture Palette ──────────────── */

export const WALL_COLOR = 0x16213e
export const WALL_THICKNESS = 8
export const DOOR_WIDTH = 90

export const SCREEN_GLOW = 0x00d4ff
export const SCREEN_BODY = 0x0a0e1a

export const LED_GREEN = 0x4ade80
export const LED_ORANGE = 0xfbbf24
export const LED_RED = 0xf87171

export const RACK_COLOR = 0x111827
export const DESK_COLOR = 0x1a2236
export const TABLE_COLOR = 0x1e293b
export const PIPE_COLOR = 0x1e3a5f

/** Per-room subtle floor tint (overlaid on FLOOR_COLOR) */
export const FLOOR_TINTS: Record<string, number> = {
  'Launch Bay': 0xff9a3c,
  'Strategy Pit': 0x4ecdc4,
  'Forum Deck': 0x7f95d1,
  'War Room': 0xf25f5c,
}

export interface DoorDef {
  /** 'v' = vertical wall gap, 'h' = horizontal wall gap */
  orientation: 'v' | 'h'
  /** Center position of the door along the wall */
  cx: number
  cy: number
  color: number
}

/** Doorways — all clustered at the center intersection forming an X hub.
 *  Any room can reach any other through the central crossroads. */
export const DOORS: readonly DoorDef[] = [
  // Launch Bay ↔ Strategy Pit  (vertical wall, near center)
  { orientation: 'v', cx: 595, cy: 385, color: 0xff9a3c },
  // Forum Deck ↔ War Room      (vertical wall, near center)
  { orientation: 'v', cx: 595, cy: 505, color: 0x7f95d1 },
  // Launch Bay ↔ Forum Deck    (horizontal wall, near center)
  { orientation: 'h', cx: 500, cy: 445, color: 0xff9a3c },
  // Strategy Pit ↔ War Room    (horizontal wall, near center)
  { orientation: 'h', cx: 700, cy: 445, color: 0x4ecdc4 },
] as const
