import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Dev server only. Vite tells the browser to keep pre-bundled packages for
    // a year without ever rechecking them, trusting the ?v= tag on the URL.
    // Here that tag does not move when the bundle is rebuilt (it is derived
    // from node_modules/.package-lock.json, which only changes on an npm
    // install), so a browser can be left holding a file that imports a chunk
    // that no longer exists, and the page dies with "The file does not exist
    // ... which is in the optimize deps directory" (25 Nov). no-cache makes
    // the browser recheck; a file that has not changed still comes back 304.
    //
    // It is a named plugin and not a plain server.headers entry on purpose:
    // plugin names feed the ?v= tag, so adding this one moved the tag off
    // f5a5deb6, the value browsers hold year-long stale copies under. Remove
    // or rename it and the tag changes again; back to f5a5deb6 if removed.
    {
      name: 'revalidate-prebundled-deps',
      apply: 'serve',
      config: () => ({ server: { headers: { 'Cache-Control': 'no-cache' } } }),
    },
  ],
  server: {
    fs: {
      allow: [resolve(__dirname, '..')],
    },
  },
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  // The admin imports TypeScript from outside this package (shared/,
  // supabase/functions/_shared/). For those, Vite looks up the repo root's
  // tsconfig.json, which extends expo/tsconfig.base, and Vercel only installs
  // landing-page/'s packages, so the build fails as soon as there is no warm
  // build cache (it did on 18 Nov, after the project moved team). A fixed
  // tsconfig here means Vite never reads the root one. The only options it
  // took from there that esbuild uses: target ESNext, and class fields as
  // ESNext defines them.
  esbuild: {
    tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'esnext', useDefineForClassFields: true } }),
  },
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
        // Same shell trick for /affiliates (the programme pitch; /affiliate is the portal).
        affiliates: resolve(__dirname, 'affiliates.html'),
      },
    },
  },
})
