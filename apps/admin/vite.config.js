import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mirwal admin application (admin.mirwal.pk). Administrative functionality only — never bundled into the storefront.
// Its own build: nothing from the other two Mirwal applications is resolvable from here,
// so a visitor to this app never downloads another application's bundle.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    watch: { usePolling: true },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
