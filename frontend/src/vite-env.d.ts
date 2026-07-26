/// <reference types="vite/client" />

// Injected by vite.config.ts `define`, and mirrored onto window in main.tsx so Cesium
// can find its Workers/Assets/Widgets under public/cesium/.
declare const CESIUM_BASE_URL: string;

// Injected by `define` too: false in the normal server-backed build, true in the single-file
// build (vite.config.single.ts). Constant at compile time so the unused branch is dropped.
declare const SINGLE_FILE: boolean;

interface Window {
  CESIUM_BASE_URL: string;
}

interface Window {
  __viewer?: unknown;
  __store?: unknown;
}
