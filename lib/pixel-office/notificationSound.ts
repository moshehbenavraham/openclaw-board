import {
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
} from './constants'

let soundEnabled = true
let audioCtx: AudioContext | null = null
let bgmAudio: HTMLAudioElement | null = null
let bgmGestureRetryBound = false

const BGM_SRC = '/assets/pixel-office/pixel-adventure.mp3'
const BGM_VOLUME = 0.28

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled
  if (!enabled) stopBackgroundMusic()
}

export function isSoundEnabled(): boolean {
  return soundEnabled
}

function playNote(ctx: AudioContext, freq: number, startOffset: number): void {
  const t = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t)

  gain.gain.setValueAtTime(NOTIFICATION_VOLUME, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + NOTIFICATION_NOTE_DURATION_SEC)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(t)
  osc.stop(t + NOTIFICATION_NOTE_DURATION_SEC)
}

function getBgmAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!bgmAudio) {
    bgmAudio = new Audio(BGM_SRC)
    bgmAudio.loop = true
    bgmAudio.preload = 'auto'
    bgmAudio.volume = BGM_VOLUME
  }
  return bgmAudio
}

function bindBgmGestureRetry(): void {
  if (typeof window === 'undefined' || bgmGestureRetryBound) return
  bgmGestureRetryBound = true

  const cleanup = () => {
    if (typeof window === 'undefined' || !bgmGestureRetryBound) return
    bgmGestureRetryBound = false
    window.removeEventListener('pointerdown', resumeOnGesture)
    window.removeEventListener('touchstart', resumeOnGesture)
    window.removeEventListener('keydown', resumeOnGesture)
  }

  const resumeOnGesture = () => {
    if (!soundEnabled) {
      cleanup()
      return
    }
    const audio = getBgmAudio()
    if (!audio) {
      cleanup()
      return
    }
    audio.play().then(() => {
      cleanup()
    }).catch(() => {
      // Keep listeners for next user gesture attempt.
    })
  }

  window.addEventListener('pointerdown', resumeOnGesture, { passive: true })
  window.addEventListener('touchstart', resumeOnGesture, { passive: true })
  window.addEventListener('keydown', resumeOnGesture)
}

export async function playDoneSound(): Promise<void> {
  if (!soundEnabled) return
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC)
    playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC)
  } catch {
    // Audio may not be available
  }
}

export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
  } catch {
    // ignore
  }
}

export async function playBackgroundMusic(): Promise<void> {
  if (!soundEnabled) return
  try {
    const audio = getBgmAudio()
    if (!audio) return
    audio.muted = false
    audio.loop = true
    audio.volume = BGM_VOLUME
    await audio.play()
  } catch {
    // Browser autoplay may block playback until a user gesture.
    bindBgmGestureRetry()
  }
}

export function stopBackgroundMusic(): void {
  if (!bgmAudio) return
  bgmAudio.pause()
  bgmAudio.currentTime = 0
}
