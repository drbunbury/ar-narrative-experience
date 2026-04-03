/**
 * main.js — entry point
 * Orchestrates: background asset preload → splash → XR pipeline start
 */

import { unlockAudio } from './audio.js'
import { initExperience, onUpdate } from './experience.js'

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

async function boot() {
  // 1. Begin fetching models immediately (no user gesture needed for fetch)
  const preloadDone = preloadAssets()

  // 2. Wait for all assets to finish
  await preloadDone

  // 3. Unlock the Begin button
  loadingLabel.textContent = 'Ready'
  beginBtn.classList.add('ready')
  beginBtn.disabled = false

  // 4. Wait for user tap — required to unlock AudioContext and start camera
  await new Promise((resolve) => {
    beginBtn.addEventListener('click', resolve, { once: true })
  })

  // 5. Dismiss splash
  splash.classList.add('hidden')
  // Remove from DOM after transition to free memory
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })

  // 6. Unlock audio (must happen inside the user gesture callstack)
  await unlockAudio()

  // 7. Start XR pipeline (8th Wall)
  startXR()
}

// ---------------------------------------------------------------------------
// 8th Wall XR pipeline
// ---------------------------------------------------------------------------

function startXR() {
  // Guard — 8th Wall may not be available in dev without the binary
  if (typeof XR8 === 'undefined') {
    console.warn('[main] XR8 not available — running in preview mode without AR.')
    startPreviewMode()
    return
  }

  const canvas = document.getElementById('ar-canvas')

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    {
      name: 'narrative-experience',
      onStart({ canvas: c, GLctx }) {
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
