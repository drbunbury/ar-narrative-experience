# ar-narrative-experience

## Project Overview
A WebAR story-driven experience. Users scan a QR code, are taken to a webpage,
and see a 3D character or object placed in real-world space. As they pan to one
side they discover a second character/object. Panning back reveals the original
has changed — advancing the narrative. Audio plays when specific models are in view.

## Stack
- **8th Wall XR Engine** — binary in `/public/xrengine/` (download from 8thwall.org)
- **Three.js** — 3D rendering, camera pose reading, raycasting
- **Vite** — dev server and bundler
- **Vanilla JS** — no frontend frameworks
- **Netlify** — hosting, auto-deployed from GitHub (`main` branch)

## Project Structure
```
ar-narrative-experience/
├── CLAUDE.md
├── index.html
├── netlify.toml
├── vite.config.js
├── package.json
├── public/
│   └── xrengine/          ← 8th Wall binary (xr.js + supporting files)
├── src/
│   ├── main.js            ← Scene setup, 8th Wall pipeline init, render loop
│   ├── experience.js      ← Narrative logic: pan detection, state, model swap
│   ├── audio.js           ← Web Audio API helpers, trigger management
│   └── ui.js              ← Overlay prompts ("pan right", tap-to-start screen)
└── assets/
    ├── models/
    │   ├── character-a.glb        ← Initial character (scene start)
    │   ├── character-b.glb        ← Discovered when user pans right
    │   └── character-a-altered.glb ← Replaces character-a after discovery
    └── audio/
        ├── ambient.mp3            ← Background atmosphere
        ├── discovery.mp3          ← Plays when character-b comes into view
        └── transformation.mp3     ← Plays when character-a changes
```

## Narrative Flow
1. User scans QR code → lands on HTTPS page
2. **Tap-to-start screen** — user taps to grant camera + unlock audio context
3. 8th Wall SLAM finds a surface → character-a is placed in world space
4. UI prompt fades in: *"Something is nearby… look around"*
5. User pans right (~40° yaw) → character-b appears, `discovery.mp3` plays
6. UI prompt: *"Look back"*
7. User pans back left → character-a has transformed into character-a-altered, `transformation.mp3` plays
8. Experience complete — ambient audio continues

## State Machine (`experience.js`)
```js
const STATE = {
  phase: 'waiting',       // waiting | placed | discovered | transformed
  hasPlaced: false,
  hasDiscoveredB: false,
  hasTransformed: false,
}
```
Phase transitions drive all model visibility and audio triggers.

## Key Implementation Notes
- **Camera yaw** is extracted via `THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y`
- **Pan thresholds**: right discovery > 40°, return trigger < 10° (after discovery)
- **Audio unlock**: must happen inside a user gesture handler (the tap-to-start screen)
- **Raycasting**: cast from `{x:0, y:0}` (screen centre) to detect model-in-view
- **SLAM dependency**: character-a placement waits for `XR8.XrController.recenter()` confirmation
- All 3D positions are in **metres**
- Keep GLB files **under 5MB** — use Draco compression in Blender export
- 8th Wall pipeline module order matters: GlTextureRenderer → Threejs → custom module

## Dev Commands
```bash
npm run dev          # Vite dev server on localhost:5173
npm run build        # Production build → /dist
npm run preview      # Preview production build locally
netlify deploy --prod --dir=dist   # Manual deploy if needed
```

## Phone Testing
Camera requires HTTPS. Use ngrok to tunnel localhost to your phone:
```bash
ngrok http 5173
# Open the https://xxx.ngrok.io URL on your phone
```

## Deployment
- **Auto-deploy**: every push to `main` branch triggers Netlify build
- **Build command**: `npm run build`
- **Publish directory**: `dist`
- **Netlify URL**: update this once connected → https://easterstory.netlify.app
- **QR code**: generate from the Netlify URL at qr-code-generator.com or similar

## Conventions
- State lives exclusively in the `STATE` object — no scattered flags
- Each src file has a single responsibility (see Project Structure above)
- Comment all threshold values with the reasoning (e.g. `// 40° — enough to be intentional, not accidental`)
- Prefer `const` and arrow functions throughout
- No TypeScript for now — plain JS with JSDoc comments for key functions

## Assets To-Do
- [ ] Create/source character-a.glb
- [ ] Create/source character-b.glb
- [ ] Create/source character-a-altered.glb
- [ ] Record/source ambient.mp3
- [ ] Record/source discovery.mp3
- [ ] Record/source transformation.mp3
- [ ] Download 8th Wall engine binary from 8thwall.org → place in /public/xrengine/
