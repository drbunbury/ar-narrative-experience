/**
 * main.js — entry point
 * Orchestrates: background asset preload → splash → XR pipeline start
 */

import { unlockAudio } from './audio.js'
import { initExperience, onUpdate } from './experience.js'

// ---------------------------------------------------------------------------
// Debug overlay
// Shown automatically when ?debug is in the URL, or whenever an error fires.
// ---------------------------------------------------------------------------

const debugEl = document.getElementById('debug')
const showDebug = new URLSearchParams(location.search).has('debug')
if (showDebug) debugEl.classList.add('visible')

function dbg(msg, level = 'info') {
  const line = document.createElement('div')
  line.className = level
  const ts = new Date().toISOString().slice(11, 23)
  line.textContent = `[${ts}] ${msg}`
  debugEl.prepend(line)    // newest at top
  console[level === 'err' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[dbg] ${msg}`)
}

function showDebugOnError() {
  debugEl.classList.add('visible')
}

// Catch unhandled JS errors and surface them in the overlay
window.addEventListener('error', (e) => {
  showDebugOnError()
  dbg(`UNCAUGHT: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`, 'err')
})
window.addEventListener('unhandledrejection', (e) => {
  showDebugOnError()
  dbg(`UNHANDLED PROMISE: ${e.reason}`, 'err')
})

// ---------------------------------------------------------------------------
// XR8 promise — resolves when engine fires 'xrloaded', or null after timeout.
// Pattern from public/xrengine/tools/entry.js.
// ---------------------------------------------------------------------------

const XR8Promise = new Promise((resolve) => {
  if (window.XR8) {
    dbg('XR8 already present on window', 'ok')
    resolve(window.XR8)
  } else {
    dbg('waiting for xrloaded event…')
    window.addEventListener('xrloaded', () => {
      dbg('xrloaded event fired ✓', 'ok')
      resolve(window.XR8)
    }, { once: true })
  }
})

// Also listen for XR8's own error event on the window
window.addEventListener('xrerror', (e) => {
  showDebugOnError()
  dbg(`xrerror: ${JSON.stringify(e.detail)}`, 'err')
})

const XR8WithTimeout = Promise.race([
  XR8Promise,
  new Promise((resolve) => setTimeout(() => {
    dbg('XR8 did not load within 6 s — falling back to preview mode', 'warn')
    resolve(null)
  }, 6000)),
])

// ---------------------------------------------------------------------------
// Asset manifest
// ---------------------------------------------------------------------------

const MODEL_URLS = [
  '/assets/models/character-a.glb',
  '/assets/models/character-b.glb',
  '/assets/models/character-a-altered.glb',
]

export const preloadedBuffers = {}

// ---------------------------------------------------------------------------
// UI refs
// ---------------------------------------------------------------------------

const splash       = document.getElementById('splash')
const loadingBar   = document.getElementById('loading-bar')
const loadingLabel = document.getElementById('loading-label')
const beginBtn     = document.getElementById('begin-btn')

// ---------------------------------------------------------------------------
// Background preload — models only; audio unlocked after user gesture
// ---------------------------------------------------------------------------

async function preloadAssets() {
  let completed = 0

  const fetchModel = async (url) => {
    try {
      dbg(`fetching ${url.split('/').pop()}…`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      preloadedBuffers[url] = await res.arrayBuffer()
      dbg(`loaded ${url.split('/').pop()} (${(preloadedBuffers[url].byteLength / 1024).toFixed(1)} KB)`, 'ok')
    } catch (err) {
      dbg(`failed to load ${url.split('/').pop()}: ${err.message}`, 'warn')
    }
    completed++
    loadingBar.style.width = `${Math.round((completed / MODEL_URLS.length) * 100)}%`
  }

  await Promise.all(MODEL_URLS.map(fetchModel))
  dbg('asset preload complete', 'ok')
}

// ---------------------------------------------------------------------------
// Camera permission check (best-effort — not all browsers support this)
// ---------------------------------------------------------------------------

async function checkCameraPermission() {
  if (!navigator.permissions) {
    dbg('Permissions API not available — skipping camera check', 'warn')
    return
  }
  try {
    const status = await navigator.permissions.query({ name: 'camera' })
    dbg(`camera permission state: ${status.state}`, status.state === 'denied' ? 'err' : 'info')
    status.addEventListener('change', () => {
      dbg(`camera permission changed → ${status.state}`, 'info')
    })
  } catch (e) {
    dbg(`camera permission query failed: ${e.message}`, 'warn')
  }
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

async function boot() {
  dbg('boot started')
  dbg(`HTTPS: ${location.protocol === 'https:' ? 'yes ✓' : 'NO — camera requires HTTPS'}`,
      location.protocol === 'https:' ? 'ok' : 'err')
  dbg(`userAgent: ${navigator.userAgent.slice(0, 80)}`)

  checkCameraPermission()

  // Kick off model preload and XR8 load in parallel
  const [xr8] = await Promise.all([XR8WithTimeout, preloadAssets()])

  dbg(xr8 ? 'XR8 ready ✓' : 'XR8 not available', xr8 ? 'ok' : 'warn')

  loadingLabel.textContent = xr8 ? 'Ready' : 'Preview mode (no AR)'
  beginBtn.classList.add('ready')
  beginBtn.disabled = false

  dbg('Begin button unlocked — waiting for tap')

  await new Promise((resolve) => {
    beginBtn.addEventListener('click', resolve, { once: true })
  })

  dbg('user tapped Begin')

  splash.classList.add('hidden')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })

  try {
    await unlockAudio()
    dbg('AudioContext unlocked ✓', 'ok')
  } catch (e) {
    dbg(`AudioContext unlock failed: ${e.message}`, 'warn')
  }

  if (xr8) {
    startXR(xr8)
  } else {
    dbg('starting preview mode (Three.js only)', 'warn')
    startPreviewMode()
  }
}

// ---------------------------------------------------------------------------
// 8th Wall XR pipeline
// ---------------------------------------------------------------------------

function startXR(XR8) {
  dbg('configuring XR8 pipeline…')
  const canvas = document.getElementById('ar-canvas')

  // Ensure canvas fills the viewport at device resolution before XR8 takes it
  canvas.width  = window.innerWidth  * window.devicePixelRatio
  canvas.height = window.innerHeight * window.devicePixelRatio

  XR8.XrController.configure({ disableWorldTracking: false })

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),  // camera feed composited behind scene
    XR8.Threejs.pipelineModule(),            // Three.js render loop
    XR8.XrController.pipelineModule(),       // SLAM surface detection + camera pose
    {
      name: 'narrative-experience',

      onStart({ canvas: c }) {
        dbg('pipeline onStart ✓', 'ok')
        const { scene, camera } = XR8.Threejs.xrScene()
        initExperience(scene, camera)
      },

      onUpdate() {
        const { camera } = XR8.Threejs.xrScene()
        onUpdate(camera)
      },

      // Surface / camera permission errors come through here
      onError(error) {
        showDebugOnError()
        dbg(`pipeline onError: ${JSON.stringify(error)}`, 'err')
      },

      onException({ error }) {
        showDebugOnError()
        dbg(`pipeline onException: ${error?.message ?? error}`, 'err')
      },
    },
  ])

  dbg('calling XR8.run()…')
  XR8.run({ canvas })
  dbg('XR8.run() called — waiting for camera grant…', 'info')
}

// ---------------------------------------------------------------------------
// Preview mode — plain Three.js renderer for desktop / no-camera testing
// ---------------------------------------------------------------------------

function startPreviewMode() {
  import('three').then(({ Scene, PerspectiveCamera, WebGLRenderer, Color, AmbientLight, DirectionalLight }) => {
    dbg('preview mode: initialising Three.js renderer', 'info')
    const canvas = document.getElementById('ar-canvas')
    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(window.devicePixelRatio)

    const scene = new Scene()
    scene.background = new Color(0x111118)

    // Basic lighting so the placeholder GLBs are visible
    scene.add(new AmbientLight(0xffffff, 0.6))
    const sun = new DirectionalLight(0xffffff, 1.2)
    sun.position.set(2, 4, 3)
    scene.add(sun)

    const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100)
    camera.position.set(0, 1.6, 0)

    initExperience(scene, camera)
    dbg('preview mode: scene initialised ✓', 'ok')

    const tick = () => {
      requestAnimationFrame(tick)
      onUpdate(camera)
      renderer.render(scene, camera)
    }
    tick()

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }).catch((e) => {
    dbg(`preview mode failed to import three: ${e.message}`, 'err')
    showDebugOnError()
  })
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

boot()
