/*
 * Layout 1 (reference-faithful): traffic panel left, cursor readout bottom-left,
 * camera/layer cluster top-right, feed chips along the bottom.
 *
 * Tailwind is used for LAYOUT ONLY. Everything visual comes from styles/tokens.css.
 * Unknown values render as an em-dash. Never as invented data.
 */
import { useStore, type Aircraft } from "../state/store";

const DASH = "—";

function fmt(n: number | null | undefined, suffix = ""): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH;
  return `${Math.round(n).toLocaleString("en-US")}${suffix}`;
}

/* ---------------- left: air traffic ---------------- */

export function TrafficPanel() {
  const aircraft = useStore((s) => s.aircraft);
  const source = useStore((s) => s.source);

  const byOperator = new Map<string, number>();
  for (const a of aircraft) {
    const key = a.military ? "MILITARY" : (a.operator ?? "UNKNOWN");
    byOperator.set(key, (byOperator.get(key) ?? 0) + 1);
  }
  const rows = [...byOperator.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const max = rows.length ? rows[0][1] : 1;

  return (
    <div className="panel w-[210px] pointer-events-auto">
      <div className="panel-h">
        <span className="lbl" style={{ color: "var(--cyan)" }}>▸ Air traffic</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{aircraft.length}</span>
      </div>

      <div className="py-1">
        {rows.length === 0 && (
          <div className="px-[10px] py-2 lbl">
            {source ? "No contacts in range" : "Awaiting feed"}
          </div>
        )}
        {rows.map(([name, n]) => (
          <div key={name} className="px-[10px] py-[3px]">
            <div className="flex justify-between" style={{ fontSize: 10, letterSpacing: ".08em" }}>
              <span style={{ color: name === "MILITARY" ? "var(--amber)" : "var(--dim)" }}>
                {name.slice(0, 18).toUpperCase()}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>
            </div>
            <div
              className="bar"
              style={{
                width: `${Math.max(6, (n / max) * 100)}%`,
                background: name === "MILITARY" ? "var(--amber)" : "var(--cyan)",
              }}
            />
          </div>
        ))}
      </div>

      {/* Honest empty state. There is no AIS source: measured zero coverage at Mobile. */}
      <div className="panel-h" style={{ borderTop: "1px solid var(--line)", borderBottom: "none" }}>
        <span className="lbl">▸ Sea traffic</span>
        <span style={{ color: "var(--dim)" }}>{DASH}</span>
      </div>
      <div className="px-[10px] pb-2">
        <div className="lbl" style={{ color: "var(--amber)", fontSize: 9 }}>No AIS source</div>
      </div>
    </div>
  );
}

/* ---------------- bottom-left: cursor readout ---------------- */

export function CursorReadout() {
  const cursor = useStore((s) => s.cursor);
  const depthM = useStore((s) => s.depthM);
  const pending = useStore((s) => s.depthPending);

  const isWater = depthM !== null && depthM < 0;
  return (
    <div className="panel w-[176px] pointer-events-auto">
      <div className="row">
        <span>Lat</span>
        <span>{cursor ? cursor.lat.toFixed(4) : DASH}</span>
      </div>
      <div className="row">
        <span>Lon</span>
        <span>{cursor ? cursor.lon.toFixed(4) : DASH}</span>
      </div>
      <div className="row">
        <span>{isWater ? "Depth" : "Elev"}</span>
        <span>
          {pending ? "…" : depthM === null ? DASH : `${Math.abs(depthM).toLocaleString()} M`}
        </span>
      </div>
    </div>
  );
}

/* ---------------- top-right: layer toggles ---------------- */

export function LayerCluster() {
  const showBands = useStore((s) => s.showBands);
  const showDatum = useStore((s) => s.showDatum);
  const showDropLines = useStore((s) => s.showDropLines);
  const toggle = useStore((s) => s.toggle);

  const Item = ({ on, label, k }: { on: boolean; label: string; k: Parameters<typeof toggle>[0] }) => (
    <button
      onClick={() => toggle(k)}
      className="w-full text-left"
      style={{
        font: "inherit", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase",
        background: "transparent", cursor: "pointer", padding: "5px 9px",
        border: "1px solid var(--line-bright)", borderRadius: 0, marginTop: 4,
        color: on ? "var(--cyan)" : "var(--dim)",
      }}
    >
      {on ? "▪" : "▫"} {label}
    </button>
  );

  return (
    <div className="panel p-[6px] w-[168px] pointer-events-auto">
      <div className="lbl px-[3px]">Layers</div>
      <Item on={showBands} label="Altitude bands" k="showBands" />
      <Item on={showDatum} label="Datum plane" k="showDatum" />
      <Item on={showDropLines} label="Drop lines" k="showDropLines" />
    </div>
  );
}

/* ---------------- right: selected contact ---------------- */

export function SelectionPanel() {
  const hex = useStore((s) => s.selectedHex);
  const aircraft = useStore((s) => s.aircraft);
  const sepFt = useStore((s) => s.separationFt);
  const radius = useStore((s) => s.datumRadiusNm);
  const select = useStore((s) => s.select);

  const a: Aircraft | undefined = hex ? aircraft.find((x) => x.hex === hex) : undefined;
  if (!a) return null;

  const co = aircraft.filter(
    (o) => o.hex !== a.hex && o.alt_ft !== null && a.alt_ft !== null &&
      Math.abs(o.alt_ft - a.alt_ft) <= sepFt,
  );

  return (
    <div className={`panel w-[212px] pointer-events-auto ${a.military ? "panel--alert" : ""}`}>
      <div className="panel-h">
        <span style={{ color: a.military ? "var(--amber)" : "var(--cyan)", fontSize: 11, letterSpacing: ".1em" }}>
          {(a.flight || a.hex || DASH).toUpperCase()}
        </span>
        <button onClick={() => select(null)} className="lbl" style={{ background: "none", border: "none", cursor: "pointer" }}>×</button>
      </div>
      <div className="py-1">
        <div className="row"><span>ICAO24</span><span>{a.hex?.toUpperCase() ?? DASH}</span></div>
        <div className={`row ${a.military ? "row--mil" : ""}`}>
          <span>Class</span><span>{a.military ? "MILITARY" : "CIVIL"}</span>
        </div>
        <div className="row"><span>Speed</span><span>{fmt(a.gs_kt, " KT")}</span></div>
        <div className="row"><span>Altitude</span><span>{fmt(a.alt_ft, " FT")}</span></div>
        <div className="row"><span>V/S</span><span>{fmt(a.geom_rate_fpm ?? a.baro_rate_fpm, " FPM")}</span></div>
        <div className="row"><span>Heading</span><span>{a.track_deg === null ? DASH : `${Math.round(a.track_deg)}°`}</span></div>
        <div className="row"><span>Lat</span><span>{a.lat.toFixed(4)}</span></div>
        <div className="row"><span>Lon</span><span>{a.lon.toFixed(4)}</span></div>
      </div>
      <div className="py-1" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="row"><span>Reg</span><span>{a.registration ?? DASH}</span></div>
        <div className="row"><span>Type</span><span>{a.type ?? DASH}</span></div>
        <div className="row"><span>Operator</span>
          <span style={{ fontSize: 10 }}>{a.operator ? a.operator.slice(0, 16) : DASH}</span>
        </div>
        {/* Phase 2 fills these from adsbdb. Until then they are honestly unknown. */}
        <div className="row row--dim"><span>Origin</span><span>{DASH}</span></div>
        <div className="row row--dim"><span>Dest</span><span>{DASH}</span></div>
      </div>
      <div className="py-1" style={{ borderTop: "1px solid var(--line)" }}>
        <div className={`row ${co.length ? "row--mil" : "row--dim"}`}>
          <span>Co-alt ±{sepFt}</span><span>{co.length}</span>
        </div>
        <div className="row"><span>Datum radius</span><span>{radius} NM</span></div>
      </div>
    </div>
  );
}

/* ---------------- bottom: status bar ---------------- */

export function StatusBar() {
  // One selector per field on purpose. A selector returning a fresh object is a new
  // reference every render, which under zustand v5 loops until React bails out with
  // "Maximum update depth exceeded".
  const source = useStore((s) => s.source);
  const degraded = useStore((s) => s.degraded);
  const lastFetchOk = useStore((s) => s.lastFetchOk);
  const aircraft = useStore((s) => s.aircraft);
  const fps = useStore((s) => s.fps);
  const home = useStore((s) => s.home);

  const mil = aircraft.filter((a) => a.military).length;

  return (
    <div
      className="absolute left-0 right-0 bottom-0 flex items-center gap-5 px-3"
      style={{
        height: 24, borderTop: "1px solid var(--line)", background: "rgba(5,7,10,.9)",
        fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--dim)",
      }}
    >
      <span className="chip">
        <span className={`dot ${!lastFetchOk ? "dot--off" : degraded ? "dot--warn" : ""}`} />
        {!lastFetchOk ? "ADS-B offline" : source ? `${source} live` : "connecting"}
      </span>
      <span className="chip"><span className="dot dot--off" />AIS no source</span>
      <span className="chip">{aircraft.length} air</span>
      <span className="chip" style={{ color: mil ? "var(--amber)" : undefined }}>{mil} mil</span>
      <span className="chip">{home.label}</span>
      <span className="ml-auto chip">{fps} FPS · WebGL2</span>
    </div>
  );
}

/* ---------------- attribution: mandatory, not optional ---------------- */

export function Attribution() {
  return (
    <div
      className="absolute right-3"
      style={{ bottom: 30, fontSize: 8, color: "var(--dim)", letterSpacing: ".06em" }}
    >
      GEBCO Compilation Group · aircraft data © airplanes.live (non-commercial)
    </div>
  );
}
