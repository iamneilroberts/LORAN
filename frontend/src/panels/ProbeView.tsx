/**
 * `#probe` — the mobile Cesium viability instrument (D-073's measurement gate).
 *
 * The question it exists to answer: can the REAL globe hold a usable frame rate on the owner's
 * actual phone, and which of the three desktop-tuned settings is the one that hurts? Until that
 * is measured on a handset, "reflow the console" (Option A) and "replace Cesium" are both
 * guesses, and one of them is expensive.
 *
 * WHY IT MOUNTS THE REAL GLOBE. A mock would measure the mock. This route renders `<Globe/>`
 * exactly as the console does - same layers, same live contacts - and puts a readable overlay on
 * top. What it does NOT render is the console's chrome, because that chrome is precisely what
 * collapses at 390px (D-072), and an unreadable instrument measures nothing.
 *
 * WHY IT REPORTS drMs AND NOT ONLY FPS. Throttling dead reckoning saves CPU while Cesium carries
 * on rendering at the same rate, so the frame counter would not move at all and the saving would
 * be invisible. Resolution scale is the opposite: it is GPU work, so it shows up in FPS. Two
 * different costs need two different numbers, and reporting only one would quietly hide half the
 * answer.
 *
 * NOTHING HERE CHANGES THE DESKTOP. The knobs default to the shipped behaviour and are only moved
 * by this route. Reload without the hash and the console is untouched.
 */
import { useEffect, useRef, useState } from "react";

import { useStore } from "../state/store";
import { drainPerfStats, perfKnobs } from "../globe/perfKnobs";

const DASH = "—";

/** `#probe` — a hash, matching the glance view's reasoning (D-072). */
export function isProbeRoute(): boolean {
  return typeof window !== "undefined"
    && window.location.hash.replace(/^#/, "").toLowerCase() === "probe";
}

/** The unmangled GPU string, which is the single most useful line for judging a result. */
function rendererString(): string {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return "no WebGL";
    const dbg = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    const raw = dbg
      ? (gl as WebGLRenderingContext).getParameter(
          (dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
        )
      : null;
    const ver = (gl as WebGLRenderingContext).getParameter(
      (gl as WebGLRenderingContext).VERSION,
    );
    return String(raw ?? ver ?? DASH);
  } catch {
    return DASH;
  }
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
      <span className="lbl" style={{ fontSize: 10, color: "var(--off)", minWidth: 104 }}>{k}</span>
      <span
        style={{
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: warn ? "var(--amber)" : "var(--txt)",
          wordBreak: "break-word",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Choice<T extends string | number>(
  { label, value, options, onPick, note }:
  { label: string; value: T; options: T[]; onPick: (v: T) => void; note?: string },
) {
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <div className="lbl" style={{ fontSize: 10, color: "var(--off)" }}>{label}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={String(o)}
            onClick={() => onPick(o)}
            className="lbl"
            style={{
              // Deliberately finger-sized. Every control on the console is cursor-sized, which
              // is one of the reasons it is unusable on a phone; an instrument that cannot be
              // driven with a thumb would not get used on the device it is measuring.
              minWidth: 62, minHeight: 40, fontSize: 12,
              border: "1px solid " + (o === value ? "var(--cyan)" : "var(--line-bright)"),
              color: o === value ? "var(--cyan)" : "var(--dim)",
              background: "transparent",
            }}
          >
            {String(o)}
          </button>
        ))}
      </div>
      {note && (
        <div className="lbl" style={{ fontSize: 9, color: "var(--off)", marginTop: 5 }}>{note}</div>
      )}
    </div>
  );
}

/**
 * One line of detail for the selected contact, and a plain statement of which globe geometry is
 * currently drawn for it.
 *
 * Not a dossier - the dossier is 344px of chrome and reproducing it here would rebuild the exact
 * thing that collapses at 390px. The point is narrower: when you tap an aircraft to judge the 3D
 * view, you need to know WHY you are or are not seeing a filed-route line, because "no line" has
 * three different meanings (nothing selected / adsbdb has no route / the D-062 check withdrew it)
 * and an unlabelled absence looks identical to a bug.
 */
function Selected() {
  const selectedHex = useStore((s) => s.selectedHex);
  const aircraft = useStore((s) => s.aircraft);
  const enrichment = useStore((s) => s.enrichment);
  const enrichPending = useStore((s) => s.enrichPending);
  const showDestination = useStore((s) => s.showDestination);
  const showDropLines = useStore((s) => s.showDropLines);
  const showProjection = useStore((s) => s.showProjection);

  const a = selectedHex ? aircraft.find((x) => x.hex === selectedHex) : undefined;
  if (!a) {
    return (
      <div className="lbl" style={{ fontSize: 10, color: "var(--off)", padding: "6px 0" }}>
        Tap a contact to draw its geometry.
      </div>
    );
  }

  // Only trust a reply that belongs to the contact on screen (same rule the dossier uses).
  const en = enrichment && enrichment.hex?.toUpperCase() === a.hex?.toUpperCase()
    ? enrichment : null;
  const route = en?.route ?? null;
  const orig = route?.origin;
  const dest = route?.destination;

  const legState = (end: { lat: number | null; lon: number | null } | null | undefined) => {
    if (!showDestination) return "toggle off";
    if (enrichPending) return "…";
    if (!en) return DASH;
    if (!end) return "adsbdb: no route";
    if (end.lat == null || end.lon == null) return "no coords";
    return "drawn";
  };

  return (
    <div style={{ padding: "6px 0" }}>
      <Row k="Selected" v={`${a.flight?.trim() || a.hex || DASH} · ${a.alt_ft != null ? `${Math.round(a.alt_ft).toLocaleString()} ft` : DASH} · ${a.gs_kt != null ? `${Math.round(a.gs_kt)} kt` : DASH}`} />
      <Row
        k="Filed orig"
        v={`${orig?.icao ?? orig?.iata ?? DASH} — ${legState(orig)}`}
      />
      <Row
        k="Filed dest"
        v={`${dest?.icao ?? dest?.iata ?? DASH} — ${legState(dest)}`}
      />
      <Row k="Drop line" v={showDropLines ? "drawn (to ground)" : "toggle off"} />
      <Row k="Projection" v={showProjection ? "drawn" : "toggle off"} />
    </div>
  );
}

export function ProbeView() {
  const aircraft = useStore((s) => s.aircraft);
  const source = useStore((s) => s.source);
  const showCounties = useStore((s) => s.showCounties);
  const showStates = useStore((s) => s.showStates);
  const toggle = useStore((s) => s.toggle);

  const [scale, setScale] = useState(1);
  const [drHz, setDrHz] = useState(0);
  const [open, setOpen] = useState(true);
  const [stats, setStats] = useState({ fps: 0, drCallsPerS: 0, drMsPerS: 0, msPerDrCall: 0 });
  const [buffer, setBuffer] = useState(DASH);

  const renderer = useRef(rendererString());
  const mark = useRef(performance.now());

  // `viewer.resolutionScale` is set straight through the debug handle rather than via a knob:
  // it is one assignment Cesium already supports, and `__viewer` is an intentional surface
  // (Globe.tsx:80). Effective buffer scale is devicePixelRatio * resolutionScale, because
  // `useBrowserRecommendedResolution` is false - that multiplication IS the thing under test.
  useEffect(() => {
    const v = (window as unknown as { __viewer?: { resolutionScale: number } }).__viewer;
    if (v) v.resolutionScale = scale;
  }, [scale]);

  useEffect(() => { perfKnobs.drHz = drHz; }, [drHz]);

  // Reset the knob on unmount so leaving the probe cannot leave the console throttled.
  useEffect(() => () => { perfKnobs.drHz = 0; }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      const now = performance.now();
      setStats(drainPerfStats(now - mark.current));
      mark.current = now;
      const c = document.querySelector("canvas");
      setBuffer(c ? `${(c as HTMLCanvasElement).width}x${(c as HTMLCanvasElement).height}` : DASH);
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const dpr = window.devicePixelRatio || 1;
  // D-073 recorded this as "the Cesium canvas forces the layout viewport wider than the device",
  // measured as innerWidth 482 under a 390 override. Re-measured with the real globe mounted,
  // innerWidth and clientWidth are BOTH exactly 390 - the layout viewport is fine. What is
  // actually wrong is ordinary horizontal OVERFLOW: scrollWidth 501 against a 390 viewport,
  // sourced from a status bar that will not wrap. So the signal to watch is scrollWidth vs
  // clientWidth, which is portable and points at the offending element, rather than innerWidth
  // vs screen.width - that one false-positives under CDP emulation, which overrides one and not
  // the other, and is probably how the original 482 reading happened.
  const clientW = document.documentElement.clientWidth;
  const scrollW = document.documentElement.scrollWidth;
  const overflowPx = Math.max(0, scrollW - clientW);

  return (
    <div
      style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        display: "flex", flexDirection: "column", justifyContent: "flex-start",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          margin: 8,
          padding: "10px 12px",
          border: "1px solid var(--line-bright)",
          background: "rgba(5,7,10,.86)",
          maxWidth: 360,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="lbl" style={{ fontSize: 11, color: "var(--cyan)" }}>PROBE</span>
          <span style={{ fontSize: 26, fontVariantNumeric: "tabular-nums", color: "var(--txt)" }}>
            {stats.fps.toFixed(0)}
          </span>
          <span className="lbl" style={{ fontSize: 10, color: "var(--off)" }}>FPS</span>
          <button
            onClick={() => setOpen((o) => !o)}
            className="lbl"
            style={{
              marginLeft: "auto", minHeight: 34, minWidth: 58, fontSize: 11,
              border: "1px solid var(--line-bright)", color: "var(--dim)", background: "transparent",
            }}
          >
            {open ? "HIDE" : "SHOW"}
          </button>
        </div>

        {open && (
          <>
            <div style={{ marginTop: 8 }}>
              <Row k="DR cost" v={`${stats.drMsPerS.toFixed(1)} ms/s · ${stats.drCallsPerS.toFixed(0)}/s · ${stats.msPerDrCall.toFixed(2)} ms ea`} />
              <Row k="Contacts" v={`${aircraft.length}${source ? ` · ${source}` : ""}`} />
              <Row k="DPR" v={String(dpr)} />
              <Row k="Viewport" v={`${window.innerWidth}x${window.innerHeight} css · client ${clientW}`} />
              <Row
                k="Overflow"
                v={overflowPx > 0 ? `+${overflowPx}px (scrollWidth ${scrollW})` : "none"}
                warn={overflowPx > 0}
              />
              <Row k="GL buffer" v={buffer} />
              <Row k="Renderer" v={renderer.current} />
              {overflowPx > 0 && (
                <div className="lbl" style={{ fontSize: 9, color: "var(--amber)", marginTop: 4 }}>
                  Content is wider than the viewport, so the page scrolls sideways. This is a CSS
                  overflow problem, NOT Cesium widening the layout viewport — D-073 recorded the
                  latter and it did not reproduce.
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--line)", marginTop: 6 }}>
                <Selected />
              </div>
            </div>

            <Choice
              label="Resolution scale"
              value={scale}
              options={[1, 0.75, 0.5, 0.33]}
              onPick={setScale}
              note={`buffer = DPR ${dpr} x scale. GPU work is the square of this — expect FPS to move.`}
            />
            <Choice
              label="Dead reckoning"
              value={drHz}
              options={[0, 10, 5]}
              onPick={setDrHz}
              note="0 = every frame (shipped). At 500 kt a contact moves 4.3 m per frame at 60 fps — watch DR cost, not FPS."
            />
            <Choice
              label="County boundaries"
              value={showCounties ? "on" : "off"}
              options={["on", "off"]}
              onPick={(v) => { if ((v === "on") !== showCounties) toggle("showCounties"); }}
              note={`3619 county rings, built lazily and OFF by default — so this measures the cost of turning them on, not a cost you are already paying. States: ${showStates ? "858 rings shown" : "hidden"}.`}
            />
            <Choice
              label="State boundaries"
              value={showStates ? "on" : "off"}
              options={["on", "off"]}
              onPick={(v) => { if ((v === "on") !== showStates) toggle("showStates"); }}
              note="858 rings, ON by default — this one IS part of the standing cost."
            />

            <div className="lbl" style={{ fontSize: 9, color: "var(--off)", marginTop: 10 }}>
              Pinch and drag the globe behind this panel. Numbers settle after a second or two.
              Leaving this route restores every default.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
