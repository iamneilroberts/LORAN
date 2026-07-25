import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { useStore } from "./state/store";

window.CESIUM_BASE_URL = CESIUM_BASE_URL;
// Single-user homelab console: exposing the store beats hiding it when something misbehaves.
(window as unknown as { __store: typeof useStore }).__store = useStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
