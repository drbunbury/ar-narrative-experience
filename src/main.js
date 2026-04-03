/**
 * main.js — entry point
 * Orchestrates: background asset preload → splash → XR pipeline start
 */

import { unlockAudio } from './audio.js'
import { initExperience, onUpdate } from './experience.js'

// ---------------------------------------------------------------------------
// Resolves when the 8th Wall engine is ready (fires "xrloaded" event on window
// once the async CDN script has parsed and initialised). Pattern from
// public/xrengine/tools/entry.js.
// ---------------------------------------------------------------------------
const XR8Promise = new Promise((resolve) => {
  if (window.XR8) {
    resolve(window.XR8)
  } else {
    window.addEventListener('xrloaded', () => resolve(window.XR8), { once: true })
  }
})

// ---------------------------------------------------------------------------
// Asset manifest — everything that needs to be ready before the experience
// ---------------------------------------------------------------------------

const MODEL_URLS = [
  '/assets/models/character-a.glb',
  '/assets/models/character-b.glb',
  '/assets/models/character-a-altered.glb',
]

// Cached ArrayBuffers keyed by URL — GLTFLoader can consume these directly
// so we don't download twice. Exported for experience.js to consume.
export const preloadedBuffers = {}

// ---------------------------------------------------------------------------
// UI refs
// ---------------------------------------------------------------------------

const splash      = document.getElementById('splash')
const loadingBar  = document.getElementById('loading-bar')
const loadingLabel = document.getElementById('loading-label')
const beginBtn    = document.getElementById('begin-btn')

// ---------------------------------------------------------------------------
// Background preload
// Fetches each model file in parallel, tracks per-file completion,
// drives the progress bar. Audio is left for after the user gesture.
// ---------------------------------------------------------------------------

async function preloadAssets() {
  let completed = 0

  const fetchModel = async (url) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      preloadedBuffers[url] = await res.arrayBuffer()
    } catch (err) {
      console.warn(`[preload] Could not load ${url}:`, err)
      // Don't block the experience — continue with whatever loaded
    }
    completed++
    const pct = Math.round((completed / MODEL_URLS.length) * 100)
    loadingBar.style.width = `${pct}%`
  }

  await Promise.all(MODEL_URLS.map(fetchModel))
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

// Resolves with XR8 instance, or null if the engine doesn't load within 6 s
// (e.g. desktop browser, offline, unsupported device).
const XR8WithTimeout = Promise.race([
  XR8Promise,
  new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
])

async function boot() {
  // 1. Kick off model preload and engine load in parallel — both happen while
  //    the user reads the splash screen.
  const [xr8] = await Promise.all([XR8WithTimeout, preloadAssets()])

  // 2. Everything ready — unlock the Begin button
  loadingLabel.textContent = xr8 ? 'Ready' : 'Preview mode'
  beginBtn.classList.add('ready')
  beginBtn.disabled = false

  // 3. Wait for user tap — required to unlock AudioContext and start camera
  await new Promise((resolve) => {
    beginBtn.addEventListener('click', resolve, { once: true })
  })

  // 4. Dismiss splash
  splash.classList.add('hidden')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })

  // 5. Unlock audio (must happen inside the user gesture callstack)
  await unlockAudio()

  // 6. Start XR pipeline, or fall back to plain Three.js preview on desktop
  if (xr8) {
    startXR(xr8)
  } else {
    console.warn('[main] XR8 not available — running in preview mode without AR.')
    startPreviewMode()
  }
}

// ---------------------------------------------------------------------------
// 8th Wall XR pipeline
// ---------------------------------------------------------------------------

/**
 * @param {typeof window.XR8} XR8 — resolved engine instance from XR8Promise
 */
function startXR(XR8) {
  const canvas = document.getElementById('ar-canvas')

  // XrController handles SLAM surface detection and camera pose.
  // GlTextureRenderer composites the live camera feed behind the 3D scene.
  // Threejs wires up the Three.js renderer to the XR render loop.
  XR8.XrController.configure({ disableWorldTracking: false })

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    {
      name: 'narrative-experience',
      onStart() {
        const { scene, camera } = XR8.Threejs.xrScene()
        initExperience(scene, camera)
      },
      onUpdate() {
        const { camera } = XR8.Threejs.xrScene()
        onUpdate(camera)
      },
    },
  ])

  XR8.run({ canvas })
}

// ---------------------------------------------------------------------------
// Preview mode — lets you see the experience in a browser without AR hardware
// ---------------------------------------------------------------------------

function startPreviewMode() {
  import('three').then(({ Scene, PerspectiveCamera, WebGLRenderer, Color }) => {
    const canvas = document.getElementById('ar-canvas')
    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(window.devicePixelRatio)

    const scene = new Scene()
    scene.background = new Color(0x111118)

    const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100)
    camera.position.set(0, 1.6, 0)

    initExperience(scene, camera)

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
  })
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

boot()
