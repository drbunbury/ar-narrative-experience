import { defineConfig } from 'vite'

export default defineConfig({
  // Ensure the 8th Wall binary in /public is served as-is
  publicDir: 'public',

  build: {
    target: 'es2020',
    // Warn if any chunk exceeds 1MB (GLBs should be in /public, not bundled)
    chunkSizeWarningLimit: 1000,
  },

  server: {
    // Allow ngrok and other tunnels to connect
    allowedHosts: 'all',
    headers: {
      'Permissions-Policy': 'camera=*, microphone=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
