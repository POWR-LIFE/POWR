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
        // NOT a separate static page any more — partners.html is an SPA shell
        // that boots the same bundle. Its only job is carrying partner-specific
        // og: tags, which a React route cannot do on a single-page app. Vercel
        // serves a matching static file BEFORE applying the SPA rewrite, so
        // /partners is served from this shell and React Router takes it from
        // there. Any new entry added here must keep <div id="root"> and the
        // /main.jsx script, or that route renders a blank page.
        partners: resolve(__dirname, 'partners.html'),
      },
    },
  },
})
