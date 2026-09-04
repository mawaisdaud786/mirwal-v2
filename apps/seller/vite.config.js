import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mirwal seller application (seller.mirwal.pk). Seller portal only — independent of both the storefront and the admin app.
// Its own build: nothing from the other two Mirwal applications is resolvable from here,
// so a visitor to this app never downloads another application's bundle.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    watch: { usePolling: true },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
