/*
 * Layout 1 (reference-faithful): traffic panel left, cursor readout bottom-left,
 * camera/layer cluster top-right, feed chips along the bottom.
 *
 * Tailwind is used for LAYOUT ONLY. Everything visual comes from styles/tokens.css.
 * Unknown values render as an em-dash. Never as invented data.
 */
import { useEffect, useState } from "react";
import {
  useStore, type Aircraft, type EnrichAirport, type Enrichment, type PhotoResult,
} from "../state/store";

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

/** Airport code for the dossier row; the full name goes in the hover title. */
function airportCode(p: EnrichAirport | null | undefined): string {
  return p?.iata ?? p?.icao ?? DASH;
}

function airportTitle(p: EnrichAirport | null | undefined): string | undefined {
  if (!p) return undefined;
  return [p.name, p.municipality].filter(Boolean).join(" · ") || undefined;
}

/**
 * Fetch adsbdb detail whenever the selected contact changes.
 *
 * A reply that arrives after the user has moved on is dropped: the store also holds the hex
 * the reply belongs to, and the panel refuses to render a mismatch. Showing one aircraft's
 * registration under another's callsign is exactly the kind of plausible-looking wrong data
 * ground rule 1 exists to prevent.
 */
function useEnrichment(hex: string | null, callsign: string | null) {
  useEffect(() => {
    if (!hex) return;
    let cancelled = false;
    const q = new URLSearchParams({ hex: hex.toUpperCase() });
    if (callsign) q.set("callsign", callsign.toUpperCase());

    useStore.getState().setEnrichment(null, true);
    fetch(`/api/enrich?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Enrichment) => { if (!cancelled) useStore.getState().setEnrichment(d, false); })
      .catch((e) => {
        if (cancelled) return;
        // Could not ask. That is not the same as "adsbdb does not know", and the panel says so.
        useStore.getState().setEnrichment(
          { hex, callsign, aircraft: null, route: null, errors: [String(e)] }, false,
        );
      });

    return () => { cancelled = true; };
  }, [hex, callsign]);
}

/**
 * Fetch photo METADATA for the selected contact.
 *
 * Registration is the better key by a wide margin - the hex endpoint is known to return a
 * real photo of the WRONG aircraft for a couple of misconfigured-transponder hex values
 * (see backend/app/feeds/planespotters.py). Registration may arrive from the live feed or
 * later from adsbdb, so this re-runs when it turns up; the backend cache absorbs the repeat.
 */
function usePhoto(hex: string | null, registration: string | null) {
  useEffect(() => {
    if (!hex) return;
    let cancelled = false;
    const q = new URLSearchParams({ hex: hex.toUpperCase() });
    if (registration) q.set("reg", registration.toUpperCase());

    useStore.getState().setPhoto(null, true);
    fetch(`/api/photo?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PhotoResult) => { if (!cancelled) useStore.getState().setPhoto(d, false); })
      .catch((e) => {
        if (cancelled) return;
        useStore.getState().setPhoto(
          { hex, registration, photo: null, matched_on: null, errors: [String(e)] }, false,
        );
      });

    return () => { cancelled = true; };
  }, [hex, registration]);
}

/**
 * The photo block. Attribution here is a licence condition, not styling (D-009):
 *   - the photographer's name is visible TEXT beside the image, never a tooltip,
 *   - the thumbnail links to the planespotters photo page with a PLAIN href,
 *     deliberately WITHOUT rel="nofollow" and without rel="noreferrer",
 *   - the image is loaded from their CDN at the exact URL they gave us. We never download,
 *     re-host, resize or rewrite it.
 * If their CDN fails to serve the image we say so rather than leaving a broken frame.
 */
function PhotoBlock({ result, pending }: { result: PhotoResult | null; pending: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const p = result?.photo ?? null;
  const broke = !!p && failedSrc === p.src;

  let note: string | null = null;
  if (pending) note = "Loading photo…";
  else if (result && result.errors.length) note = "planespotters unavailable";
  else if (broke) note = "Photo unavailable from CDN";
  else if (result && !p) note = "No photo on file";

  return (
    <div className="py-1" style={{ borderTop: "1px solid var(--line)" }}>
      {p && !broke && (
        <>
          <a href={p.link} target="_blank" rel="noopener" style={{ display: "block" }}>
            <img
              src={p.src}
              alt=""
              onError={() => setFailedSrc(p.src)}
              style={{ display: "block", width: "100%", height: "auto", border: 0 }}
            />
          </a>
          <div className="px-[10px] pt-1 lbl" style={{ fontSize: 8, letterSpacing: ".06em" }}>
            © {p.photographer ?? "Unknown"} · planespotters.net
          </div>
        </>
      )}
      {note && (
        <div className="px-[10px] py-1 lbl"
             style={{ fontSize: 9, color: broke || result?.errors.length ? "var(--amber)" : undefined }}>
          {note}
        </div>
      )}
    </div>
  );
}

export function SelectionPanel() {
  const hex = useStore((s) => s.selectedHex);
  const aircraft = useStore((s) => s.aircraft);
  const sepFt = useStore((s) => s.separationFt);
  const radius = useStore((s) => s.datumRadiusNm);
  const select = useStore((s) => s.select);
  const enrichment = useStore((s) => s.enrichment);
  const enrichPending = useStore((s) => s.enrichPending);
  const peaks = useStore((s) => s.peaks);
  const photo = useStore((s) => s.photo);
  const photoPending = useStore((s) => s.photoPending);

  const a: Aircraft | undefined = hex ? aircraft.find((x) => x.hex === hex) : undefined;

  // Only trust a reply that belongs to the contact on screen.
  const en = enrichment && enrichment.hex?.toUpperCase() === a?.hex?.toUpperCase()
    ? enrichment : null;

  // Hooks run before the early return, so the panel disappearing mid-flight is not a hook
  // ordering violation.
  useEnrichment(a?.hex ?? null, a?.flight ?? null);
  usePhoto(a?.hex ?? null, a?.registration ?? en?.aircraft?.registration ?? null);
  if (!a) return null;
  const enAc = en?.aircraft ?? null;
  const enRoute = en?.route ?? null;
  const enrichFailed = (en?.errors.length ?? 0) > 0;

  // The live feed wins where it has a value; adsbdb fills the gaps (adsb.lol omits ownOp
  // entirely). Whatever neither knows stays an em-dash.
  const reg = a.registration ?? enAc?.registration ?? null;
  const typeCode = a.type ?? enAc?.icao_type ?? null;
  const model = [enAc?.manufacturer, enAc?.type].filter(Boolean).join(" ") || null;
  const operator = a.operator ?? enAc?.operator ?? enRoute?.airline ?? null;
  const pending = enrichPending ? "…" : DASH;

  // Observed peaks, not airframe limits. We have no source for service ceiling or Vne.
  const peak = a.hex ? peaks[a.hex] : undefined;
  const peakMins = peak ? Math.floor((Date.now() - peak.sinceWall) / 60000) : 0;
  const peakTitle = peak
    ? `Highest observed since this contact came into range (${peakMins} min ago). Not the airframe's limit.`
    : undefined;

  const co = aircraft.filter(
    (o) => o.hex !== a.hex && o.alt_ft !== null && a.alt_ft !== null &&
      Math.abs(o.alt_ft - a.alt_ft) <= sepFt,
  );

  return (
    <div
      className={`panel w-[212px] pointer-events-auto ${a.military ? "panel--alert" : ""}`}
      // minHeight:0 is what actually lets a flex child shrink below its content height;
      // without it the panel refuses to scroll and overflows its container instead.
      style={{ minHeight: 0, overflowY: "auto" }}
    >
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
        {/* Observed peaks. Labelled OBS so they are never read as the airframe's limits. */}
        <div className={`row ${peak?.altFt != null ? "" : "row--dim"}`} title={peakTitle}>
          <span>Max alt obs</span><span>{fmt(peak?.altFt, " FT")}</span>
        </div>
        <div className={`row ${peak?.gsKt != null ? "" : "row--dim"}`} title={peakTitle}>
          <span>Max spd obs</span><span>{fmt(peak?.gsKt, " KT")}</span>
        </div>
        <div className="row"><span>Heading</span><span>{a.track_deg === null ? DASH : `${Math.round(a.track_deg)}°`}</span></div>
        <div className="row"><span>Lat</span><span>{a.lat.toFixed(4)}</span></div>
        <div className="row"><span>Lon</span><span>{a.lon.toFixed(4)}</span></div>
      </div>
      {/* Live feed first, adsbdb second, em-dash last. Never a guess. */}
      <div className="py-1" style={{ borderTop: "1px solid var(--line)" }}>
        <div className={`row ${reg ? "" : "row--dim"}`}>
          <span>Reg</span><span>{reg ?? pending}</span>
        </div>
        <div className={`row ${typeCode ? "" : "row--dim"}`}>
          <span>Type</span><span>{typeCode ?? pending}</span>
        </div>
        <div className={`row ${model ? "" : "row--dim"}`} title={model ?? undefined}>
          <span>Model</span>
          <span style={{ fontSize: 10 }}>{model ? model.slice(0, 18) : pending}</span>
        </div>
        <div className={`row ${operator ? "" : "row--dim"}`} title={operator ?? undefined}>
          <span>Operator</span>
          {/* 16 chars cut "AMERICAN AIRLINES" to "AMERICAN AIRLINE", which reads as wrong
              data rather than truncated data. Full value is in the hover title. */}
          <span style={{ fontSize: 10 }}>{operator ? operator.slice(0, 20) : pending}</span>
        </div>
        <div className={`row ${enRoute?.origin ? "" : "row--dim"}`}
             title={airportTitle(enRoute?.origin)}>
          <span>Origin</span><span>{enRoute ? airportCode(enRoute.origin) : pending}</span>
        </div>
        <div className={`row ${enRoute?.destination ? "" : "row--dim"}`}
             title={airportTitle(enRoute?.destination)}>
          <span>Dest</span><span>{enRoute ? airportCode(enRoute.destination) : pending}</span>
        </div>
        {/* "Could not ask" is a different claim from "not known". Say which one it is. */}
        {enrichFailed && (
          <div className="px-[10px] pt-1 lbl" style={{ color: "var(--amber)", fontSize: 9 }}>
            adsbdb unavailable
          </div>
        )}
      </div>
      <PhotoBlock
        result={photo && photo.hex?.toUpperCase() === a.hex?.toUpperCase() ? photo : null}
        pending={photoPending}
      />
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
      GEBCO Compilation Group · aircraft data © airplanes.live (non-commercial) · airframe/route via adsbdb
    </div>
  );
}
