/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Release version from frontend/package.json, injected at build time (vite.config.ts `define`). */
declare const __APP_VERSION__: string;

declare module "*.css";
