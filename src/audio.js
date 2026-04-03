// ---------------------------------------------------------------------------
// Audio — all sounds loaded and triggered from here.
// AudioContext must be created inside a user gesture (tap-to-start).
// Call unlockAudio() from your tap handler before anything else.
// ---------------------------------------------------------------------------

let audioContext = null

/** @type {Record<string, AudioBuffer>} */
const buffers = {}

/** @type {Record<string, AudioBufferSourceNode|null>} */
const activeSources = {}

const TRACKS = {
  ambient:        '/assets/audio/ambient.mp3',
  discovery:      '/assets/audio/discovery.mp3',
  transformation: '/assets/audio/transformation.mp3',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call this inside the tap-to-start click handler.
 * Creates AudioContext (requires user gesture) and preloads all tracks.
 */
export async function unlockAudio() {
  if (audioContext) return

  audioContext = new (window.AudioContext || window.webkitAudioContext)()

  await Promise.all(
    Object.entries(TRACKS).map(([name, path]) => loadTrack(name, path))
  )
}

/**
 * Play a named track.
 * @param {string} name — key from TRACKS
 * @param {boolean} [loop=false]
 */
export function playAudio(name, loop = false) {
  if (!audioContext || !buffers[name]) return
  if (activeSources[name]) return // already playing

  const source = audioContext.createBufferSource()
  source.buffer = buffers[name]
  source.loop   = loop
  source.connect(audioContext.destination)
  source.start()

  activeSources[name] = source
  source.onended = () => { activeSources[name] = null }
}

/**
 * Stop a named track.
 * @param {string} name
 */
export function stopAudio(name) {
  if (!activeSources[name]) return
  try { activeSources[name].stop() } catch (_) {}
  activeSources[name] = null
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function loadTrack(name, path) {
  try {
    const response = await fetch(path)
    const arrayBuffer = await response.arrayBuffer()
    buffers[name] = await audioContext.decodeAudioData(arrayBuffer)
  } catch (err) {
    console.warn(`[audio] Failed to load track "${name}" from ${path}:`, err)
  }
}
