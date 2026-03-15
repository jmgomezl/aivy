import Phaser from 'phaser'
import { OfficeScene } from './OfficeScene'
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants'

export function createGameConfig(parent: HTMLDivElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0)',
    transparent: true,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [OfficeScene],
    input: {
      mouse: { preventDefaultWheel: false },
    },
  }
}
