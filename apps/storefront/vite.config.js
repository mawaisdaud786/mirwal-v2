import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mirwal customer storefront (mirwal.pk). Public marketplace only — contains no admin or seller panel code.
// Its own build: nothing from the other two Mirwal applications is resolvable from here,
// so a visitor to this app never downloads another application's bundle.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
