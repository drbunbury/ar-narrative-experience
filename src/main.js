/**
 * main.js — entry point
 * Orchestrates: background asset preload → splash → XR pipeline start
 */

import * as THREE from 'three'
import { unlockAudio } from './audio.js'
import { initExperience, onUpdate } from './experience.js'

// 8th Wall's ThreeJS pipeline module checks window.THREE at init time.
// We load Three.js as an ES module, so we must expose it globally ourselves.
window.THREE = THREE

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
// XR8 script load diagnostics
// The <script> tag is async so we need to detect both success and failure.
// ---------------------------------------------------------------------------

let xr8ScriptStatus = 'pending'   // pending | loaded | error | already-present

// Find the XR8 script tag and watch it
const xr8ScriptEl = document.querySelector('script[src*="xr.js"]')
if (xr8ScriptEl) {
  dbg(`XR8 script tag found: ${xr8ScriptEl.src}`)
  xr8ScriptEl.addEventListener('load', () => {
    xr8ScriptStatus = 'script-loaded'
    dbg('XR8 <script> downloaded OK — waiting for xrloaded event…', 'ok')
    setStatus('engine', 'pending', 'AR engine downloaded, initialising…')
  })
  xr8ScriptEl.addEventListener('error', () => {
    xr8ScriptStatus = 'script-error'
    dbg(`XR8 <script> failed to download from: ${xr8ScriptEl.src}`, 'err')
    setStatus('engine', 'fail', `Download failed: ${xr8ScriptEl.src.split('/').slice(-3).join('/')}`)
    showDebugOnError()
  })
} else {
  dbg('XR8 script tag not found in DOM', 'err')
  xr8ScriptStatus = 'no-tag'
}

// ---------------------------------------------------------------------------
// XR8 promise — resolves when engine fires 'xrloaded', or null after timeout.
// Pattern from public/xrengine/tools/entry.js.
// ---------------------------------------------------------------------------

const XR8Promise = new Promise((resolve) => {
  if (window.XR8) {
    xr8ScriptStatus = 'already-present'
    dbg('XR8 already present on window', 'ok')
    resolve(window.XR8)
  } else {
    dbg('waiting for xrloaded event…')
    window.addEventListener('xrloaded', () => {
      xr8ScriptStatus = 'loaded'
      dbg('xrloaded event fired ✓', 'ok')
      setStatus('engine', 'ok', 'AR engine ready ✓')
      resolve(window.XR8)
    }, { once: true })
  }
})

// XR8's own error event (camera denied, unsupported device, etc.)
window.addEventListener('xrerror', (e) => {
  showDebugOnError()
  dbg(`xrerror event: ${JSON.stringify(e.detail)}`, 'err')
  setSplashStatus(`AR error: ${e.detail?.type ?? 'unknown'}`, true)
})

const XR8WithTimeout = Promise.race([
  XR8Promise,
  new Promise((resolve) => setTimeout(() => {
    const reason = xr8ScriptStatus === 'script-error'
      ? 'script failed to download'
      : xr8ScriptStatus === 'script-loaded'
      ? 'script downloaded but xrloaded never fired'
      : xr8ScriptStatus === 'no-tag'
      ? 'no script tag found'
      : 'timeout waiting for xrloaded'
    dbg(`XR8 not ready after 6 s (${reason}) — preview mode`, 'warn')
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
// UI refs + status helpers
// ---------------------------------------------------------------------------

const splash       = document.getElementById('splash')
const loadingBar   = document.getElementById('loading-bar')
const loadingLabel = document.getElementById('loading-label')
const beginBtn     = document.getElementById('begin-btn')

/**
 * Update a status-list row.
 * @param {'https'|'engine'|'models'|'camera'} key
 * @param {'ok'|'fail'|'warn'|'pending'} state
 * @param {string} text
 */
function setStatus(key, state, text) {
  const li   = document.getElementById(`st-${key}`)
  const icon = li?.querySelector('.st-icon')
  const span = li?.querySelector('.st-text')
  if (!li) return
  li.className = state
  icon.textContent = state === 'ok' ? '✓' : state === 'fail' ? '✗' : state === 'warn' ? '⚠' : '⏳'
  if (text) span.textContent = text
}

/** Update the small label above the Begin button (used for AR-engine sub-states). */
function setSplashStatus(text, isError = false) {
  loadingLabel.textContent = text
  loadingLabel.style.color = isError ? 'rgba(255,100,100,0.9)' : ''
}

// ---------------------------------------------------------------------------
// Background preload — models only; audio unlocked after user gesture
// ---------------------------------------------------------------------------

async function preloadAssets() {
  let completed = 0

  let failed = 0
  const fetchModel = async (url) => {
    const name = url.split('/').pop()
    try {
      dbg(`fetching ${name}…`)
      setStatus('models', 'pending', `Loading models… (${completed}/${MODEL_URLS.length})`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      preloadedBuffers[url] = await res.arrayBuffer()
      dbg(`loaded ${name} (${(preloadedBuffers[url].byteLength / 1024).toFixed(1)} KB)`, 'ok')
    } catch (err) {
      failed++
      dbg(`failed to load ${name}: ${err.message}`, 'warn')
    }
    completed++
    loadingBar.style.width = `${Math.round((completed / MODEL_URLS.length) * 100)}%`
  }

  await Promise.all(MODEL_URLS.map(fetchModel))

  if (failed === 0) {
    setStatus('models', 'ok', `All ${MODEL_URLS.length} models loaded ✓`)
    dbg('asset preload complete', 'ok')
  } else {
    setStatus('models', 'warn', `${MODEL_URLS.length - failed}/${MODEL_URLS.length} models loaded`)
    dbg(`asset preload done with ${failed} failure(s)`, 'warn')
  }
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

  // ── HTTPS check ──────────────────────────────────────────────────────────
  const isHttps = location.protocol === 'https:' || location.hostname === 'localhost'
  dbg(`protocol: ${location.protocol} host: ${location.hostname}`, isHttps ? 'ok' : 'err')
  setStatus('https',
    isHttps ? 'ok' : 'fail',
    isHttps ? `Secure connection ✓ (${location.hostname})` : `Needs HTTPS — camera blocked on ${location.protocol}`)

  checkCameraPermission()

  // ── Kick off model preload and XR8 load in parallel ──────────────────────
  const [xr8] = await Promise.all([XR8WithTimeout, preloadAssets()])

  // ── Engine status row ────────────────────────────────────────────────────
  if (xr8) {
    setStatus('engine', 'ok', 'AR engine ready ✓')
    dbg('XR8 ready ✓', 'ok')
  } else {
    const reason = xr8ScriptStatus === 'script-error'
      ? 'Script download failed — check network / CSP'
      : xr8ScriptStatus === 'script-loaded'
      ? 'Script loaded but engine never initialised'
      : 'Engine timed out — running in preview mode'
    setStatus('engine', 'warn', reason)
    dbg(`XR8 not available: ${reason}`, 'warn')
  }

  setSplashStatus(xr8 ? 'Ready' : 'Preview mode — no live camera')
  beginBtn.classList.add('ready')
  beginBtn.disabled = false

  dbg('Begin button unlocked — waiting for tap')

  await new Promise((resolve) => {
    beginBtn.addEventListener('click', resolve, { once: true })
  })

  dbg('user tapped Begin')
  setStatus('camera', 'pending', 'Requesting camera access…')

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

  // Do NOT set canvas.width/height here — 8th Wall resizes the canvas itself
  // to match the camera stream dimensions. Pre-sizing it forces a crop that
  // makes the camera feed appear zoomed in.

  XR8.XrController.configure({ disableWorldTracking: false, enableLighting: true })

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),  // camera feed composited behind scene
    XR8.Threejs.pipelineModule(),            // Three.js render loop
    XR8.XrController.pipelineModule(),       // SLAM surface detection + camera pose
    {
      name: 'narrative-experience',

      onStart({ canvas: c }) {
        dbg('pipeline onStart ✓', 'ok')
        setStatus('camera', 'ok', 'Camera active ✓')
        const { scene, camera } = XR8.Threejs.xrScene()
        initExperience(scene, camera)
      },

      onUpdate({ processCpuResult }) {
        const { camera } = XR8.Threejs.xrScene()
        onUpdate(camera, processCpuResult?.reality?.lighting ?? null)
      },

      onError(error) {
        showDebugOnError()
        const msg = error?.type ?? JSON.stringify(error)
        dbg(`pipeline onError: ${msg}`, 'err')
        setStatus('camera', 'fail', `Camera error: ${msg}`)
      },

      onException({ error }) {
        showDebugOnError()
        const msg = error?.message ?? String(error)
        dbg(`pipeline onException: ${msg}`, 'err')
        setStatus('camera', 'fail', `Exception: ${msg}`)
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
