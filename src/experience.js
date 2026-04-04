/**
 * experience.js — narrative logic
 *
 * Tracking mode: image target (QR code).
 * character-a is anchored to the QR marker the moment it is detected.
 * character-b appears to its right when the user pans ~40° away.
 * Panning back reveals character-a has transformed.
 *
 * All world-space distances are expressed as multiples of markerScale so the
 * scene remains proportional regardless of the QR code's printed size.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { playAudio } from './audio.js'
import { showPrompt, hidePrompt } from './ui.js'

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x302820, 0.75)
const dirLight  = new THREE.DirectionalLight(0xffffff, 1.5)
dirLight.position.set(1, 3, 2)

let lightEstimateLogged = false

function applyLightEstimate(lighting) {
  if (!lightEstimateLogged) {
    console.log('[lighting] first estimate received:', JSON.stringify(lighting))
    lightEstimateLogged = true
  }
  const main    = lighting.lmain    ?? lighting.directional ?? null
  const ambient = lighting.lambient ?? lighting.ambient     ?? null
  if (main) {
    if (main.intensity != null) dirLight.intensity = main.intensity * 2.5
    if (main.color)             dirLight.color.setRGB(...main.color)
    if (main.direction)         dirLight.position.set(...main.direction)
  }
  if (ambient) {
    if (ambient.intensity != null) hemiLight.intensity = ambient.intensity * 1.5
    if (ambient.color)             hemiLight.color.setRGB(...ambient.color)
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const STATE = {
  phase: 'waiting',        // waiting | placed | discovered | transformed
  hasPlaced: false,
  hasDiscoveredB: false,
  hasTransformed: false,
  markerScale: 1,          // set from image target event; 1 = 1 metre wide marker
  targetVisible: false,
}

// ---------------------------------------------------------------------------
// Scene references
// ---------------------------------------------------------------------------

let scene, camera
const loader = new GLTFLoader()

/** Root object that all characters are parented to.
 *  Moved as a unit when the marker pose updates. */
const root = new THREE.Group()

/** @type {THREE.Object3D|null} */ let characterA        = null
/** @type {THREE.Object3D|null} */ let characterAAltered = null
/** @type {THREE.Object3D|null} */ let characterB        = null

const raycaster = new THREE.Raycaster()

// ---------------------------------------------------------------------------
// Scanning prompt — cycles every 1 s while waiting for the QR code
// ---------------------------------------------------------------------------

const SCAN_MESSAGES = [
  'Find the QR code and point your camera at it…',
  'Hold the QR code steady in view…',
  'Scanning for marker…',
]
let scanInterval = null
let scanIndex    = 0

function startScanning() {
  scanIndex = 0
  showPrompt(SCAN_MESSAGES[scanIndex])
  scanInterval = setInterval(() => {
    scanIndex = (scanIndex + 1) % SCAN_MESSAGES.length
    showPrompt(SCAN_MESSAGES[scanIndex])
  }, 1000)
}

function stopScanning() {
  clearInterval(scanInterval)
  scanInterval = null
  hidePrompt()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initExperience(xrScene, xrCamera) {
  scene  = xrScene
  camera = xrCamera

  scene.add(hemiLight)
  scene.add(dirLight)
  scene.add(root)

  root.visible = false   // hidden until QR code detected
  loadModels()
  startScanning()
}

/** Called every frame by the pipeline. */
export function onUpdate(xrCamera, lightingEstimate = null) {
  camera = xrCamera

  if (lightingEstimate) applyLightEstimate(lightingEstimate)

  if (!STATE.hasPlaced) return

  if (STATE.phase === 'placed') checkPanRight()
  if (STATE.phase === 'discovered') checkPanBack()

  checkModelInView()
}

// ---------------------------------------------------------------------------
// Image target events — called from main.js pipeline
// ---------------------------------------------------------------------------

/**
 * QR code came into view for the first time (or re-appeared after loss).
 * @param {{ position, rotation, scale }} detail
 */
export function onTargetFound({ position, rotation, scale }) {
  STATE.targetVisible = true
  applyTargetPose(position, rotation, scale)

  if (!STATE.hasPlaced) {
    STATE.markerScale = scale    // physical width of marker in metres
    STATE.hasPlaced   = true
    STATE.phase       = 'placed'
    root.visible      = true
    stopScanning()
    showPrompt('Something is nearby… look around')
    console.log(`[experience] marker found, scale=${scale.toFixed(3)} m`)
  }
}

/**
 * Marker pose has been refined this frame.
 * Only update root position while story hasn't progressed — once discovery
 * happens we let characters stay where they are so the user can look away.
 */
export function onTargetUpdated({ position, rotation, scale }) {
  STATE.targetVisible = true
  if (STATE.phase === 'placed') {
    applyTargetPose(position, rotation, scale)
  }
}

/** Marker left the frame — characters stay frozen in last known position. */
export function onTargetLost() {
  STATE.targetVisible = false
}

// ---------------------------------------------------------------------------
// Pose application
// ---------------------------------------------------------------------------

/**
 * Move the root group to match the detected marker's world-space pose.
 * @param {{ x,y,z }} position
 * @param {{ x,y,z,w }} rotation  quaternion
 * @param {number} scale          marker width in metres
 */
function applyTargetPose(position, rotation, scale) {
  root.position.set(position.x, position.y, position.z)
  root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
  // Keep the root at marker scale so child offsets are in "marker-widths"
  root.scale.setScalar(scale)
}

// ---------------------------------------------------------------------------
// Model loading
// Offsets are in local (root) space, so 1 unit = 1 marker-width.
// ---------------------------------------------------------------------------

function loadModels() {
  // character-a: 1.5 marker-widths in front of the marker, centred
  loader.load('/assets/models/character-a.glb', (gltf) => {
    characterA = gltf.scene
    characterA.position.set(0, 0, -1.5)
    characterA.visible = true
    root.add(characterA)
  })

  // character-b: 2.5 marker-widths to the right, hidden initially
  loader.load('/assets/models/character-b.glb', (gltf) => {
    characterB = gltf.scene
    characterB.position.set(2.5, 0, -1.5)
    characterB.visible = false
    root.add(characterB)
  })

  // character-a-altered: same spot as character-a, hidden initially
  loader.load('/assets/models/character-a-altered.glb', (gltf) => {
    characterAAltered = gltf.scene
    characterAAltered.position.set(0, 0, -1.5)
    characterAAltered.visible = false
    root.add(characterAAltered)
  })
}

// ---------------------------------------------------------------------------
// Pan detection
// ---------------------------------------------------------------------------

function getCameraYaw() {
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  return THREE.MathUtils.radToDeg(euler.y)
}

function checkPanRight() {
  if (STATE.hasDiscoveredB || !characterB) return
  // 40° — enough to be intentional, not accidental head movement
  if (getCameraYaw() > 40) discoverCharacterB()
}

function checkPanBack() {
  if (STATE.hasTransformed || !characterAAltered) return
  // < 10° means they've returned close to forward after discovering B
  if (getCameraYaw() < 10) transformCharacterA()
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
  if (characterA)        characterA.visible = false
  if (characterAAltered) characterAAltered.visible = true
  playAudio('transformation')
  setTimeout(hidePrompt, 3000)
}

// ---------------------------------------------------------------------------
// Audio trigger — ambient plays when character-b is centred in view
// ---------------------------------------------------------------------------

function checkModelInView() {
  if (!characterB || !STATE.hasDiscoveredB) return
  raycaster.setFromCamera({ x: 0, y: 0 }, camera)
  if (raycaster.intersectObject(characterB, true).length > 0) {
    playAudio('ambient')
  }
}
