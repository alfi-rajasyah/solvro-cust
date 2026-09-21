import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
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
        navigateFallbackDenylist: [/^\/api\//],
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
