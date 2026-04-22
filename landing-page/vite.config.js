import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    fs: {
      allow: [resolve(__dirname, '..')],
    },
  },
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        partners: resolve(__dirname, 'partners.html'),
      },
    },
  },
})
