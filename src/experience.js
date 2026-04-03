import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { playAudio } from './audio.js'
import { showPrompt, hidePrompt } from './ui.js'

// ---------------------------------------------------------------------------
// State machine — all narrative state lives here, nowhere else
// ---------------------------------------------------------------------------
const STATE = {
  phase: 'waiting',       // waiting | placed | discovered | transformed
  hasPlaced: false,
  hasDiscoveredB: false,
  hasTransformed: false,
}

// ---------------------------------------------------------------------------
// Scene references
// ---------------------------------------------------------------------------
let scene, camera
const loader = new GLTFLoader()

/** @type {THREE.Object3D|null} */
let characterA = null
/** @type {THREE.Object3D|null} */
let characterAAltered = null
/** @type {THREE.Object3D|null} */
let characterB = null

const raycaster = new THREE.Raycaster()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call once when the XR session starts.
 * @param {THREE.Scene} xrScene
 * @param {THREE.Camera} xrCamera
 */
export function initExperience(xrScene, xrCamera) {
  scene  = xrScene
  camera = xrCamera

  loadModels()
}

/**
 * Called every frame by the 8th Wall pipeline.
 * @param {THREE.Camera} xrCamera — live AR camera each frame
 */
export function onUpdate(xrCamera) {
  camera = xrCamera

  if (STATE.phase === 'waiting' || STATE.phase === 'placed') {
    checkPanRight()
  }

  if (STATE.phase === 'discovered') {
    checkPanBack()
  }

  checkModelInView()
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

function loadModels() {
  // character-a — visible from the start
  loader.load('/assets/models/character-a.glb', (gltf) => {
    characterA = gltf.scene
    characterA.position.set(0, 0, -1.5) // 1.5m in front of user
    characterA.visible = true
    scene.add(characterA)
    STATE.phase = 'placed'
    STATE.hasPlaced = true
  })

  // character-b — hidden until user pans right
  loader.load('/assets/models/character-b.glb', (gltf) => {
    characterB = gltf.scene
    characterB.position.set(2.5, 0, -1.5) // 2.5m to the right
    characterB.visible = false
    scene.add(characterB)
  })

  // character-a-altered — replaces character-a after discovery
  loader.load('/assets/models/character-a-altered.glb', (gltf) => {
    characterAAltered = gltf.scene
    characterAAltered.position.set(0, 0, -1.5)
    characterAAltered.visible = false
    scene.add(characterAAltered)
  })
}

// ---------------------------------------------------------------------------
// Pan detection
// ---------------------------------------------------------------------------

/**
 * Returns camera yaw in degrees (-180 to 180).
 * YXZ order isolates horizontal rotation from tilt.
 */
function getCameraYaw() {
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  return THREE.MathUtils.radToDeg(euler.y)
}

function checkPanRight() {
  if (STATE.hasDiscoveredB) return
  if (!characterB) return

  const yaw = getCameraYaw()

  // 40° — enough to be intentional, not accidental head movement
  if (yaw > 40) {
    discoverCharacterB()
  }
}

function checkPanBack() {
  if (STATE.hasTransformed) return
  if (!characterAAltered) return

  const yaw = getCameraYaw()

  // < 10° means they've returned close to forward after discovering B
  if (yaw < 10) {
    transformCharacterA()
  }
}

// ---------------------------------------------------------------------------
// Narrative transitions
// ---------------------------------------------------------------------------

function discoverCharacterB() {
  STATE.hasDiscoveredB = true
  STATE.phase = 'discovered'

  characterB.visible = true
  playAudio('discovery')
  showPrompt('Look back…')
}

function transformCharacterA() {
  STATE.hasTransformed = true
  STATE.phase = 'transformed'

  if (characterA) characterA.visible = false
  if (characterAAltered) characterAAltered.visible = true

  playAudio('transformation')
  setTimeout(hidePrompt, 3000)
}

// ---------------------------------------------------------------------------
// Audio trigger — plays when a model is centred in view
// ---------------------------------------------------------------------------

function checkModelInView() {
  if (!characterB || !STATE.hasDiscoveredB) return

  // Cast ray from screen centre
  raycaster.setFromCamera({ x: 0, y: 0 }, camera)
  const hits = raycaster.intersectObject(characterB, true)

  if (hits.length > 0) {
    playAudio('ambient')
  }
}
