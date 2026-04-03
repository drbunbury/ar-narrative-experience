# ar-narrative-experience

A story-driven WebAR experience built with [8th Wall](https://8thwall.org) + Three.js.

Scan a QR code → see a character in real space → pan to discover a second character → pan back to find the first has changed.

## Dev setup

```bash
npm install
npm run dev
# Use ngrok for phone testing (camera requires HTTPS)
ngrok http 5173
```

## Deploy
Auto-deploys to Netlify on push to `main`.

## Stack
- 8th Wall XR Engine (open source, 8thwall.org)
- Three.js
- Vite
- Netlify
