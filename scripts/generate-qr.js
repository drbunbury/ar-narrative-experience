/**
 * generate-qr.js
 * Generates the QR code that serves dual purpose:
 *   1. Scanned by phone camera → opens the AR experience URL
 *   2. Displayed in the real world → image target for AR anchoring
 *
 * Outputs:
 *   public/assets/qr-target.png  — the marker image (upload this to 8th Wall
 *                                   image target compiler, and print/display it)
 *
 * Run: node scripts/generate-qr.js [url]
 *   e.g. node scripts/generate-qr.js https://easterstory.netlify.app
 */

import QRCode from 'qrcode'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const url = process.argv[2] || 'https://easterstory.netlify.app'
const outPath = join(__dirname, '..', 'public', 'assets', 'qr-target.png')

mkdirSync(join(__dirname, '..', 'public', 'assets'), { recursive: true })

await QRCode.toFile(outPath, url, {
  type: 'png',
  width: 512,          // high-res for image target compiler
  margin: 2,           // quiet zone (required by QR spec, helps tracking)
  color: {
    dark:  '#000000',  // black modules — high contrast is essential for tracking
    light: '#ffffff',
  },
  errorCorrectionLevel: 'H', // highest redundancy — survives minor occlusion
})

console.log(`QR code written to: ${outPath}`)
console.log(`URL encoded: ${url}`)
console.log()
console.log('Next steps:')
console.log('  1. Print this QR code (any size — the AR will adapt)')
console.log('  2. Compile it into an 8th Wall image target (see README)')
console.log('     Place the compiled .targets file at: public/assets/qr-scene.targets')
