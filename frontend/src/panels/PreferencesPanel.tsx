import { useEffect } from "react";
import { LayerCluster } from "./Panels";
import { useStore } from "../state/store";

/**
 * Preferences overlay (D-056).
 *
 * LAYERS used to be a permanently docked 148px panel in the left column. The owner asked for it
 * out of that column entirely, not just made smaller - a docked panel, however it is resized,
 * always reclaims the same amount of column height whether it is being looked at or not. An
 * overlay is the only shape that costs zero column height while closed, which is the actual
 * point of moving it.
 *
 * `LayerCluster` is unchanged and still exported from Panels.tsx; this file renders it rather
 * than re-implementing its toggle logic, so there remains exactly one copy of that logic to keep
 * in sync with the store.
 */
export function PreferencesPanel() {
  const open = useStore((s) => s.prefsOpen);
  const setOpen = useStore((s) => s.setPrefsOpen);

  // Escape closes from anywhere, not just while the panel has focus - it is a `<div>`, not a
  // form control, so there is nothing else for keyboard focus to land on. Listener is only
  // attached while open, and always removed on the way out, including on unmount.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-auto"
      style={{ background: "rgba(5,7,10,.6)" }}
      onClick={() => setOpen(false)}
    >
      {/* Stops propagation so a click anywhere on the panel does not bubble to the backdrop and
          close it - only the backdrop itself and Escape should close this. */}
      <div
        className="panel pointer-events-auto"
        style={{ width: 260, maxWidth: "90vw", maxHeight: "80vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-h">
          <span className="lbl" style={{ color: "var(--cyan)" }}>▸ Preferences</span>
          <button
            onClick={() => setOpen(false)}
            className="lbl"
            style={{ background: "none", border: "none", cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        <LayerCluster />
      </div>
    </div>
  );
}
