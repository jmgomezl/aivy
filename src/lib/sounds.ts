/**
 * Tiny synth sound effects using Web Audio API.
 * No external files needed — all generated programmatically.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', vol = 0.15) {
  try {
    const ac = getCtx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, ac.currentTime)
    gain.gain.setValueAtTime(vol, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration)
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + duration)
  } catch {
    // Silent fail — audio not supported
  }
}

/** Rising two-tone chime — agent deployed */
export function playDeploy() {
  playTone(523, 0.15, 'sine', 0.12) // C5
  setTimeout(() => playTone(784, 0.3, 'sine', 0.12), 120) // G5
}

/** Quick bright ping — transaction success */
export function playSuccess() {
  playTone(880, 0.2, 'sine', 0.1) // A5
}

/** Low buzzy tone — error */
export function playError() {
  playTone(200, 0.3, 'square', 0.08)
}

/** Soft click — UI interaction */
export function playClick() {
  playTone(660, 0.06, 'sine', 0.06)
}
