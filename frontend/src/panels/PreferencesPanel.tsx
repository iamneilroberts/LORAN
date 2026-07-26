import { useEffect, useState } from "react";
import { LayerCluster } from "./Panels";
import { COLLAPSE_AFTER_MS, HOVER_EXPAND_DELAY_MS } from "./trafficCollapse";

/**
 * Docked preferences pane (D-058, reversing the D-056 overlay).
 *
 * D-056 pulled `LayerCluster` out of the left column into a modal overlay so it would cost zero
 * column height while closed. That worked, but the owner reported the overlay's `PREFS` trigger
 * on the status bar was hard to find and low-contrast, and that fiddling with settings behind a
 * backdrop read worse than a pane in the same column as everything else being fiddled with. A
 * COLLAPSING docked pane gets the same "costs nothing while shut" property the overlay was
 * chasing - collapsed, it is just this header - without hiding the controls behind a trigger
 * nobody could find.
 *
 * Collapse mechanics are copied from `TrafficPanel` rather than shared through a hook: same
 * shape (a `hovering` flag, one re-arming timeout, `COLLAPSE_AFTER_MS` / `HOVER_EXPAND_DELAY_MS`
 * imported from `trafficCollapse.ts` so the two numbers stay one number each, not two). Unlike
 * TrafficPanel, nothing here is live data that must survive a collapse - every row is inert
 * configuration - so there is no `trafficPanelSections`-style decision function to extract: the
 * one decision, "hide the body while collapsed", is the `{!collapsed && ...}` below, and a pure
 * function wrapping a single negation would not be worth the indirection.
 *
 * BEHAVIOURAL POINT: unlike the traffic panel (read, never touched), this one is full of buttons
 * the owner clicks while it is open. Clicking must never re-arm the collapse timer out from under
 * them. It doesn't: the timer only ever restarts from `onMouseLeave` firing (see the effect
 * below), and `onMouseLeave` only fires on real pointer movement out of the panel's box - a click
 * does not move the pointer, and a re-render triggered by a click does not synthesize one either,
 * even if the click shrinks the panel out from under a stationary cursor (e.g. toggling "Places"
 * off hides "Small fields" beneath it). So `hovering` stays true for as long as the cursor stays
 * put, which is exactly the "still fiddling" signal that should keep it open.
 */
export function PreferencesPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(
      () => setCollapsed(!hovering),
      hovering ? HOVER_EXPAND_DELAY_MS : COLLAPSE_AFTER_MS,
    );
    return () => window.clearTimeout(id);
  }, [hovering]);

  return (
    <div
      className="panel w-[210px] pointer-events-auto"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="panel-h">
        <span className="lbl" style={{ color: "var(--cyan)" }}>▸ Preferences</span>
      </div>
      {!collapsed && <LayerCluster />}
    </div>
  );
}
