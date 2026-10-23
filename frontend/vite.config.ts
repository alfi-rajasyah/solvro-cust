import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { readFileSync } from "node:fs";

// The version the login page shows (`__APP_VERSION__`). Single source:
// frontend/package.json, which ci/check-version.sh keeps equal to VERSION,
// backend/package.json and the image tag in setup.sh. Read with fs rather than
// imported, so tsconfig.node.json's file list stays as it is; vitest.config.ts
// defines the same constant for the unit tests.
export const APP_VERSION = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }
).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Solvro",
        short_name: "Solvro",
        description: "Solvro — project management for teams.",
        theme_color: "#3aae51",
        background_color: "#1a1a18",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // App shell precache — index.html + built assets (JS/CSS/fonts/icons).
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        navigateFallback: "/index.html",
        // Navigations under /api/ must reach the network, never the cached
        // app shell — the NavigationRoute is registered before the NetworkOnly
        // runtime route, so without this denylist it wins for navigations.
        // Guest-link navigations (/share/<token>) must also reach nginx, which
        // sends them no-store + Referrer-Policy: no-referrer; a precached
        // shell would serve them without those headers. /embed/* navigations
        // (Outline iframes) likewise need nginx's widened frame-ancestors —
        // the precached shell carries the strict 'self' header and the frame
        // would be blocked.
        navigateFallbackDenylist: [/^\/api\//, /^\/share\//, /^\/embed\//],
        runtimeCaching: [
          {
            // API responses carry auth state and must always be fresh —
            // never let the SW serve a cached response here.
            urlPattern: /\/api\/.*/,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Vite refuses requests whose Host header isn't localhost/an IP (host
    // check, 5.4.12+). When the dev server sits behind a tunnel or reverse
    // proxy (e.g. cloudflared), list the public hostnames here via
    // VITE_ALLOWED_HOSTS=host1,host2 in that container's env.
    allowedHosts: process.env.VITE_ALLOWED_HOSTS
      ? process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean)
      : undefined,
    proxy: {
      // Forward /api/* to the backend. In native dev (npm run dev on the
      // host), the backend is at http://localhost:3000. In dockerised dev
      // (vite running inside the frontend container), the backend is at
      // http://backend:3000 via the docker network — set
      // VITE_API_PROXY_TARGET=http://backend:3000 in that container's env.
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
