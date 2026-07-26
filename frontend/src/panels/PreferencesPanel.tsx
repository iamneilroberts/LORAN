import { useEffect, useState } from "react";
import { LayerCluster } from "./Panels";
import { COLLAPSE_AFTER_MS, HOVER_EXPAND_DELAY_MS } from "./trafficCollapse";
import { THEMES, useStore } from "../state/store";
import { coordLabel, parseCoord, problemText, validateHome } from "../state/homeInput";

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
/**
 * Theme chooser (D-066). Two dark, two mid-tone, grouped and labelled as such because that is
 * the distinction the owner asked for and the one that decides whether a theme suits the room.
 *
 * No light option is offered, and that is a design decision rather than an omission: D-029
 * encodes altitude as an HSL ramp at lightness 52-68, which needs a background darker than the
 * ramp itself. A light background would flatten the densest instrument on the display.
 */
function ThemeChooser() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const swatch = (t: (typeof THEMES)[number]) => (
    <button
      key={t.name}
      onClick={() => setTheme(t.name)}
      title={`${t.label} — ${t.kind === "dark" ? "dark" : "mid-tone"}`}
      style={{
        font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
        background: "transparent", cursor: "pointer", padding: "3px 0",
        border: `1px solid ${theme === t.name ? "var(--amber)" : "var(--line-bright)"}`,
        borderRadius: 0,
        color: theme === t.name ? "var(--amber)" : "var(--off)",
        textTransform: "uppercase",
      }}
    >
      {t.label}
    </button>
  );

  return (
    <div className="p-[5px]" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="lbl px-[3px]" style={{ fontSize: 9 }}>Theme</div>
      <div className="lbl px-[3px] mt-[3px]" style={{ fontSize: 8, color: "var(--off)" }}>Dark</div>
      <div className="flex gap-[2px]">
        {THEMES.filter((t) => t.kind === "dark").map(swatch)}
      </div>
      <div className="lbl px-[3px] mt-[3px]" style={{ fontSize: 8, color: "var(--off)" }}>Mid-tone</div>
      <div className="flex gap-[2px]">
        {THEMES.filter((t) => t.kind === "mid").map(swatch)}
      </div>
    </div>
  );
}

/**
 * Where the console is centred (D-068).
 *
 * The configured home in `.env` is one value for the whole install, which was fine when the only
 * viewer sat at the machine. Now that the console is reachable over a tunnel, a second viewer in
 * another city gets Mobile - not just the wrong centre, but traffic fetched around it, since the
 * feed radius is anchored here. This is the per-browser override for that.
 *
 * Nothing here invents a place name: there is no geocoder in this project, so a position the user
 * typed or the browser reported is labelled with its own coordinates. See homeInput.ts.
 */
function HomeChooser() {
  const home = useStore((s) => s.home);
  const serverHome = useStore((s) => s.serverHome);
  const override = useStore((s) => s.homeOverride);
  const setHomeOverride = useStore((s) => s.setHomeOverride);

  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const btn = {
    font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
    background: "transparent", cursor: "pointer", padding: "3px 0",
    border: "1px solid var(--line-bright)", borderRadius: 0, color: "var(--cyan)",
    textTransform: "uppercase" as const,
  };
  const field = {
    font: "inherit", fontSize: 10, width: "100%", padding: "2px 4px",
    background: "transparent", border: "1px solid var(--line-bright)", borderRadius: 0,
    color: "var(--txt)",
  };

  const apply = () => {
    const la = parseCoord(lat);
    const lo = parseCoord(lon);
    const problem = validateHome(la, lo);
    if (problem) { setNote(problemText(problem)); return; }
    setHomeOverride({ lat: la as number, lon: lo as number });
    setNote(null);
    setLat(""); setLon("");
  };

  /**
   * Browser geolocation. Every failure path says WHICH failure it was and leaves the current
   * home alone - a silent fall back to the configured position would look exactly like success
   * to someone who does not know where the configured position is.
   */
  const locate = () => {
    if (!("geolocation" in navigator)) {
      setNote("Geolocation not available in this browser");
      return;
    }
    setLocating(true);
    setNote("Requesting location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setHomeOverride({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setNote(null);
      },
      (err) => {
        setLocating(false);
        // Named, not generic: "denied" is a thing the operator can fix, "unavailable" is not.
        setNote(
          err.code === err.PERMISSION_DENIED ? "Location permission denied"
          : err.code === err.POSITION_UNAVAILABLE ? "Location unavailable"
          : err.code === err.TIMEOUT ? "Location request timed out"
          : "Location failed",
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };

  return (
    <div className="p-[5px]" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="lbl px-[3px]" style={{ fontSize: 9 }}>Centre</div>
      <div className="lbl px-[3px]" style={{ fontSize: 8, color: "var(--off)" }}>
        {home.label} · {override ? "this browser" : "configured"}
      </div>

      <div className="flex gap-[2px] mt-[3px]">
        <input style={field} value={lat} onChange={(e) => setLat(e.target.value)}
               placeholder="lat" inputMode="decimal" aria-label="Latitude" />
        <input style={field} value={lon} onChange={(e) => setLon(e.target.value)}
               placeholder="lon" inputMode="decimal" aria-label="Longitude" />
      </div>

      <div className="flex gap-[2px] mt-[3px]">
        <button style={btn} onClick={apply}>Set</button>
        <button style={{ ...btn, color: locating ? "var(--off)" : "var(--cyan)" }}
                onClick={locate} disabled={locating}>
          {locating ? "…" : "Use my location"}
        </button>
      </div>

      {override && (
        <button
          style={{ ...btn, width: "100%", marginTop: 3, color: "var(--dim)" }}
          onClick={() => { setHomeOverride(null); setNote(null); }}
          title={`Back to the configured home: ${serverHome.label}`}
        >
          Reset to configured
        </button>
      )}

      {note && (
        <div className="lbl px-[3px] pt-1" style={{ fontSize: 8, color: "var(--amber)" }}>
          {note}
        </div>
      )}
      {!note && !override && (
        <div className="lbl px-[3px] pt-1" style={{ fontSize: 8, color: "var(--off)" }}>
          {coordLabel(serverHome.lat, serverHome.lon)} from .env
        </div>
      )}
    </div>
  );
}

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
      {!collapsed && <HomeChooser />}
      {!collapsed && <ThemeChooser />}
    </div>
  );
}
