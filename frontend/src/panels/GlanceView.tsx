import { distanceNm, useStore, type Aircraft } from "../state/store";
import { bearingDeg } from "../data/routeCheck";

/**
 * The phone view (D-072). A GLANCE, deliberately not the console.
 *
 * Reached by adding `#m` to the URL — `https://host/?t=TOKEN#m`. A hash rather than a real route
 * because the app has no router and adding one would be a dependency decision (CLAUDE.md rule 2);
 * a hash also needs no server change, since `/m` would not resolve against the static mount.
 *
 * WHY THIS EXISTS RATHER THAN A RESPONSIVE CONSOLE: at a phone width the desktop layout does not
 * degrade, it collapses — the 344px dossier overlaps the traffic panel, camera cluster,
 * preferences, legend and cursor readout at once, and because panels are translucent by spec they
 * show through each other until nothing is readable. See D-072 for the measurement.
 *
 * **There is no globe here, and that is the point.** Not rendering `<Globe/>` means Cesium never
 * initialises — no WebGL context, no terrain requests, no battery cost — on the device least able
 * to afford it. (The Cesium code is still in the bundle; making it a lazy import is the obvious
 * follow-up and is not done yet.)
 *
 * Ground rules 1 and 3 apply exactly as on the desktop: an unknown field is an em-dash, and an
 * empty sky and a dead feed are DIFFERENT states that must not look alike.
 */

const DASH = "—";

/** Compass point for a bearing. Eight points: a phone glance does not need sixteen. */
function compass(deg: number): string {
  const pts = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return pts[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function Row({ a, homeLat, homeLon }: { a: Aircraft; homeLat: number; homeLon: number }) {
  const nm = distanceNm(homeLat, homeLon, a.lat, a.lon);
  const brg = bearingDeg(homeLat, homeLon, a.lat, a.lon);
  const alt = a.on_ground
    ? "GND"
    : a.alt_ft === null || a.alt_ft === undefined
      ? DASH
      : `${Math.round(a.alt_ft).toLocaleString("en-US")} ft`;

  return (
    <div
      className="flex items-baseline justify-between"
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--line)",
        // Military is the one thing worth spotting at a glance, so it keeps its colour here.
        borderLeft: `3px solid ${a.military ? "var(--mil)" : "transparent"}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, color: a.military ? "var(--mil)" : "var(--cyan)", letterSpacing: ".06em" }}>
          {a.flight || a.hex?.toUpperCase() || DASH}
        </div>
        <div style={{ fontSize: 11, color: "var(--off)", letterSpacing: ".06em" }}>
          {a.type || DASH} · {Math.round(nm)} nm {compass(brg)}
        </div>
      </div>
      <div style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" }}>
        {alt}
      </div>
    </div>
  );
}

export function GlanceView() {
  const aircraft = useStore((s) => s.aircraft);
  const source = useStore((s) => s.source);
  const lastFetchOk = useStore((s) => s.lastFetchOk);
  const errors = useStore((s) => s.errors);
  const home = useStore((s) => s.home);

  const mil = aircraft.filter((a) => a.military).length;
  // Nearest first: on a phone the only ordering that matters is "what is near me".
  const near = [...aircraft]
    .map((a) => ({ a, nm: distanceNm(home.lat, home.lon, a.lat, a.lon) }))
    .sort((x, y) => x.nm - y.nm)
    .slice(0, 12);

  return (
    <div
      style={{
        height: "100%", overflowY: "auto", background: "var(--bg)",
        display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ padding: "12px", borderBottom: "1px solid var(--line-bright)" }}>
        <div className="lbl" style={{ fontSize: 11, color: "var(--cyan)" }}>LORAN · {home.label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 8 }}>
          <div>
            <span style={{ fontSize: 34, fontVariantNumeric: "tabular-nums" }}>{aircraft.length}</span>
            <span className="lbl" style={{ fontSize: 11, color: "var(--off)" }}> AIR</span>
          </div>
          <div>
            <span style={{ fontSize: 34, fontVariantNumeric: "tabular-nums", color: mil ? "var(--mil)" : "var(--off)" }}>
              {mil}
            </span>
            <span className="lbl" style={{ fontSize: 11, color: "var(--off)" }}> MIL</span>
          </div>
        </div>
        {/*
          Feed state, said plainly. "No contacts" and "the feed is down" are different facts and
          the desktop already keeps them apart; a smaller screen is not a reason to blur them.
        */}
        <div className="lbl" style={{ fontSize: 11, marginTop: 8, color: lastFetchOk ? "var(--off)" : "var(--amber)" }}>
          {lastFetchOk && source ? `${source} · live`
            : lastFetchOk ? "awaiting feed"
            : `feed unavailable${errors.length ? ` · ${errors[0].slice(0, 60)}` : ""}`}
        </div>
      </div>

      {near.length === 0 ? (
        <div className="lbl" style={{ padding: "20px 12px", fontSize: 12, color: "var(--off)" }}>
          {lastFetchOk ? "No contacts in range" : "No data — the feed is not answering"}
        </div>
      ) : (
        <div>{near.map(({ a }) => <Row key={a.hex ?? a.flight} a={a} homeLat={home.lat} homeLon={home.lon} />)}</div>
      )}

      {/*
        Attribution follows the DATA SHOWN, not the layout (D-072). This view draws no map tiles
        and no photos, so GEBCO, Esri, OSM and planespotters are not owed a credit here — but the
        contact data and the type/operator lookup are, exactly as on the desktop.
      */}
      <div style={{ padding: "14px 12px", marginTop: "auto", fontSize: 10, color: "var(--dim)", letterSpacing: ".06em" }}>
        aircraft data © airplanes.live (non-commercial) · airframe via adsbdb
      </div>
    </div>
  );
}

/** `#m` — see the note at the top of this file for why a hash and not a route. */
export function isGlanceRoute(): boolean {
  return typeof window !== "undefined" && window.location.hash.replace(/^#/, "").toLowerCase() === "m";
}
