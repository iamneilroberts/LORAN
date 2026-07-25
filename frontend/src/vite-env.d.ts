/// <reference types="vite/client" />

// Injected by vite.config.ts `define`, and mirrored onto window in main.tsx so Cesium
// can find its Workers/Assets/Widgets under public/cesium/.
declare const CESIUM_BASE_URL: string;

interface Window {
  CESIUM_BASE_URL: string;
}

interface Window {
  __viewer?: unknown;
  __store?: unknown;
}
