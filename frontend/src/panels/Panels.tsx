/*
 * Layout 1 (reference-faithful): traffic panel left, cursor readout bottom-left,
 * camera/layer cluster top-right, feed chips along the bottom.
 *
 * Tailwind is used for LAYOUT ONLY. Everything visual comes from styles/tokens.css.
 * Unknown values render as an em-dash. Never as invented data.
 */
import { useEffect, useState } from "react";
import {
  hasSlicePerspective, matchesFilter, operatorKey, RANGE_PRESETS_NM, useStore, VERT_SCALES,
  type Aircraft, type EnrichAirport, type PhotoResult, type TrackResult,
} from "../state/store";
import { altitudeColour } from "../globe/aircraftLayer";
import { downloadGeoJSON } from "./trackExport";
import { externalLinks } from "./externalLinks";
import { checkFiledOrigin, checkFiledRoute } from "../data/routeCheck";
import { COLLAPSE_AFTER_MS, HOVER_EXPAND_DELAY_MS, trafficPanelSections } from "./trafficCollapse";
import { api, isSingleFile } from "../api";

const DASH = "—";

function fmt(n: number | null | undefined, suffix = ""): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH;
  return `${Math.round(n).toLocaleString("en-US")}${suffix}`;
}

/* ---------------- left: air traffic ---------------- */

export function TrafficPanel() {
  const aircraft = useStore((s) => s.aircraft);
  const source = useStore((s) => s.source);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);

  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Auto-collapse (D-056): a single timer, re-armed on every hover change. Hovering true starts
  // the (delayed) expand; hovering false re-arms the collapse. Each run's cleanup clears the
  // timer THAT run started, so a quick enter/leave never leaves a stale timeout to fire late -
  // and unmounting the panel clears it too, the same cleanup path. This is deliberately time-
  // based only: nothing here reads `aircraft.length` or `rows`, because a panel that tidied
  // itself away when the feed went quiet would make a dead feed look like a clean UI - the same
  // failure mode ground rule 1 forbids for invented data. See trafficCollapse.ts.
  useEffect(() => {
    const id = window.setTimeout(
      () => setCollapsed(!hovering),
      hovering ? HOVER_EXPAND_DELAY_MS : COLLAPSE_AFTER_MS,
    );
    return () => window.clearTimeout(id);
  }, [hovering]);

  const byOperator = new Map<string, number>();
  for (const a of aircraft) {
    const key = operatorKey(a);
    byOperator.set(key, (byOperator.get(key) ?? 0) + 1);
  }
  const rows = [...byOperator.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const max = rows.length ? rows[0][1] : 1;
  const milCount = aircraft.filter((a) => a.military).length;
  const shown = aircraft.filter((a) => matchesFilter(a, filter)).length;
  const filtering = filter.operator !== null || filter.militaryOnly;
  const sections = trafficPanelSections({ collapsed, filtering, hasContacts: rows.length > 0 });

  // Clicking a row toggles it. Selecting a row clears the MIL-only switch and vice versa -
  // they are two ways of narrowing the same list, and combining them silently would make the
  // count impossible to reason about.
  const pick = (name: string) =>
    setFilter({
      operator: filter.operator === name ? null : name,
      militaryOnly: false,
    });

  return (
    <div
      className="panel w-[210px] pointer-events-auto"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="panel-h">
        <span className="lbl" style={{ color: "var(--cyan)" }}>▸ Air traffic</span>
        {/* Always the TRUE total. A filter narrows what is drawn, never what is reported.
            Stays visible collapsed or not - the whole point of the count is that it does not
            depend on how much of the panel is open. */}
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{aircraft.length}</span>
      </div>

      <div className="py-1">
        {sections.emptyState && (
          <div className="px-[10px] py-2 lbl">
            {source ? "No contacts in range" : "Awaiting feed"}
          </div>
        )}
        {sections.controls && rows.map(([name, n]) => {
          const isMil = name === "MILITARY";
          const active = filter.operator === name;
          const colour = isMil ? "var(--mil)" : "var(--cyan)";
          return (
            <button
              key={name}
              onClick={() => pick(name)}
              title={active ? "Show all contacts" : `Show only ${name}`}
              className="w-full text-left px-[10px] py-[3px]"
              style={{
                font: "inherit", background: active ? "rgba(95,215,224,.07)" : "transparent",
                border: "none", borderLeft: `2px solid ${active ? colour : "transparent"}`,
                cursor: "pointer", display: "block",
              }}
            >
              <div className="flex justify-between" style={{ fontSize: 10, letterSpacing: ".08em" }}>
                <span style={{ color: active ? colour : isMil ? "var(--mil)" : "var(--dim)" }}>
                  {name.slice(0, 18).toUpperCase()}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>
              </div>
              <div className="bar" style={{
                width: `${Math.max(6, (n / max) * 100)}%`,
                background: colour,
                opacity: active ? 1 : 0.55,
              }} />
            </button>
          );
        })}
      </div>

      {/* MIL selector: independent of the operator rows, since military spans many operators.
          Collapses with the rows above it - it is a control for narrowing what is drawn, not
          information the operator needs while the panel is tucked away. */}
      {sections.controls && (
        <div className="px-[10px] pb-2 flex gap-1">
          <button
            onClick={() => setFilter({ militaryOnly: !filter.militaryOnly, operator: null })}
            disabled={milCount === 0}
            title={milCount === 0 ? "No military contacts in range" : "Show only military contacts"}
            style={{
              font: "inherit", fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase",
              padding: "4px 6px", borderRadius: 0, cursor: milCount ? "pointer" : "default",
              border: `1px solid ${filter.militaryOnly ? "var(--mil)" : "var(--line-bright)"}`,
              background: filter.militaryOnly ? "rgba(255,79,216,.12)" : "transparent",
              color: milCount ? "var(--mil)" : "var(--off)", flex: 1,
            }}
          >
            {filter.militaryOnly ? "▪" : "▫"} MIL {milCount}
          </button>
          {filtering && (
            <button
              onClick={() => setFilter({ operator: null, militaryOnly: false })}
              title="Clear the filter"
              style={{
                font: "inherit", fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase",
                padding: "4px 6px", borderRadius: 0, cursor: "pointer",
                border: "1px solid var(--line-bright)", background: "transparent",
                color: "var(--cyan)",
              }}
            >
              All
            </button>
          )}
        </div>
      )}
      {sections.filterWarning && (
        // Say plainly that the globe is not showing everything. A filter that hides traffic
        // without saying so is the same failure mode as inventing data - which is also why this
        // is NOT gated on `sections.controls`: it must stay visible through the collapse too,
        // per the owner's explicit call (D-056).
        <div className="px-[10px] pb-2 lbl" style={{ fontSize: 9, color: "var(--amber)" }}>
          Filtered · {shown} of {aircraft.length} shown
        </div>
      )}

      {sections.seaTraffic && (
        <>
          {/* Honest empty state. There is no AIS source: measured zero coverage here. */}
          <div className="panel-h" style={{ borderTop: "1px solid var(--line)", borderBottom: "none" }}>
            <span className="lbl">▸ Sea traffic</span>
            <span style={{ color: "var(--dim)" }}>{DASH}</span>
          </div>
          <div className="px-[10px] pb-2">
            <div className="lbl" style={{ color: "var(--amber)", fontSize: 9 }}>No AIS source</div>
          </div>
        </>
      )}
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
  const showDatum = useStore((s) => s.showDatum);
  const showDropLines = useStore((s) => s.showDropLines);
  const showPlaces = useStore((s) => s.showPlaces);
  const showDestination = useStore((s) => s.showDestination);
  const showSmallAirports = useStore((s) => s.showSmallAirports);
  const showAllLabels = useStore((s) => s.showAllLabels);
  const aircraftCount = useStore((s) => s.aircraft.length);
  const showRadar = useStore((s) => s.showRadar);
  const showProjection = useStore((s) => s.showProjection);
  const projMinutes = useStore((s) => s.projMinutes);
  const projSpreadDeg = useStore((s) => s.projSpreadDeg);
  const setProjection = useStore((s) => s.setProjection);
  const placeDensity = useStore((s) => s.placeDensity);
  const setPlaceDensity = useStore((s) => s.setPlaceDensity);
  const radiusNm = useStore((s) => s.radiusNm);
  const setRadiusNm = useStore((s) => s.setRadiusNm);
  const vertScale = useStore((s) => s.vertScale);
  const setVertScale = useStore((s) => s.setVertScale);
  const selected = useStore((s) => s.selectedHex);
  const pitchDeg = useStore((s) => s.cameraPitchDeg);
  const showStates = useStore((s) => s.showStates);
  const showCounties = useStore((s) => s.showCounties);
  const toggle = useStore((s) => s.toggle);

  const Item = ({
    on, label, k, note,
  }: { on: boolean; label: string; k: Parameters<typeof toggle>[0]; note?: string }) => (
    <button
      onClick={() => toggle(k)}
      title={note}
      className="w-full text-left"
      style={{
        font: "inherit", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
        background: "transparent", cursor: "pointer", padding: "4px 7px",
        border: "1px solid var(--line-bright)", borderRadius: 0, marginTop: 3,
        color: on ? "var(--cyan)" : "var(--dim)",
      }}
    >
      {on ? "▪" : "▫"} {label}
      {note && (
        <div style={{ fontSize: 8, letterSpacing: ".06em", color: "var(--off)" }}>{note}</div>
      )}
    </button>
  );

  // Both layers need a selection to exist. Saying so stops the toggles looking broken -
  // which is exactly how they read before, when clicking them did nothing visible.
  const needsSel = selected ? undefined : "needs a selected contact";
  // Same honesty for D-034: the slice is on but withheld because the camera angle cannot
  // show it. Without the note, "on and invisible" is indistinguishable from broken.
  const sliceNote = needsSel ?? (hasSlicePerspective(pitchDeg) ? undefined : "needs a tilted view");

  return (
    /* D-056/D-058: this used to be the one panel in the left column that GROWS and therefore the
       one allowed to scroll when the column ran short (`minHeight: 0` + `overflowY: auto`, same
       fix as the dossier). D-056 moved it into an overlay; D-058 moved it again, into
       PreferencesPanel's docked collapsing pane - in both homes it renders inside somebody
       else's frame, so the fixed 148px width and the scroll pair never came back.

       Nor is it `.panel` any more: `.panel` draws bracket corners via ::before/::after, and
       PreferencesPanel already wraps this in one `.panel`. Adding a second here would nest a
       harmless but pointless extra set of corners inside the first - the parent owns the frame,
       this is a section within it. */
    <div className="p-[5px]">
      <div className="lbl px-[3px]" style={{ fontSize: 9 }}>Layers</div>
      {/* This is a FETCH-scope control, not a display one - it changes what is asked of the
          upstream feed, so it costs bandwidth and upstream courtesy, not just frame time
          (D-055). It has no parent toggle to sit under, unlike Density below, so it carries
          its own label. */}
      <div className="lbl px-[3px] mt-[3px]" style={{ fontSize: 9 }}>Range · {radiusNm} nm</div>
      <div className="flex gap-[2px]">
        {RANGE_PRESETS_NM.map((nm) => (
          <button key={nm} onClick={() => setRadiusNm(nm)}
            title="Changes what is fetched from the upstream feed, not just what is drawn"
            style={{
              font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
              background: "transparent", cursor: "pointer", padding: "2px 0",
              border: "1px solid var(--line-bright)", borderRadius: 0,
              color: radiusNm === nm ? "var(--amber)" : "var(--off)",
            }}>{nm}</button>
        ))}
      </div>
      {/* VERTICAL EXAGGERATION (D-075). Off by default and never persisted, so every fresh load
          is true scale - a distorted globe restored silently on a later visit is exactly the
          plausible-looking untruth ground rule 1 forbids.

          It sits with Range because both are honest about costing something: Range costs
          upstream courtesy, this costs literal accuracy. The banner over the globe says so
          while it is on, and every READOUT stays true regardless. */}
      <div className="lbl px-[3px] mt-[3px]" style={{ fontSize: 9 }}>
        Vertical · {vertScale === 1 ? "true scale" : `${vertScale}x exaggerated`}
      </div>
      <div className="flex gap-[2px]">
        {VERT_SCALES.map((x) => (
          <button key={x} onClick={() => setVertScale(x)}
            title={x === 1
              ? "True altitude. What Cesium was chosen for."
              : `Multiply the vertical by ${x} so separation reads at a glance. Geometry only - every number stays true.`}
            style={{
              font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
              background: "transparent", cursor: "pointer", padding: "2px 0",
              border: "1px solid var(--line-bright)", borderRadius: 0,
              color: vertScale === x ? (x === 1 ? "var(--cyan)" : "var(--amber)") : "var(--off)",
            }}>{x === 1 ? "TRUE" : `${x}x`}</button>
        ))}
      </div>

      {/* The projection envelope is the primary instrument (D-047); the slice is secondary
          context and now defaults off. */}
      <Item on={showProjection} label="Projection" k="showProjection"
            note={selected ? `+${projMinutes} min · ±${projSpreadDeg}°` : "needs a selected contact"} />
      {showProjection && selected && (
        <div className="flex gap-[2px] mt-[3px]">
          {[2, 5, 10].map((m) => (
            <button key={m} onClick={() => setProjection({ minutes: m })}
              style={{
                font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
                background: "transparent", cursor: "pointer", padding: "2px 0",
                border: "1px solid var(--line-bright)", borderRadius: 0,
                color: projMinutes === m ? "var(--amber)" : "var(--off)",
              }}>{m}M</button>
          ))}
          {[5, 10, 25].map((d) => (
            <button key={`s${d}`} onClick={() => setProjection({ spreadDeg: d })}
              style={{
                font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
                background: "transparent", cursor: "pointer", padding: "2px 0",
                border: "1px solid var(--line-bright)", borderRadius: 0,
                color: projSpreadDeg === d ? "var(--amber)" : "var(--off)",
              }}>{d}°</button>
          ))}
        </div>
      )}
      {/* Filed intent, not a prediction - the note says so, because a dashed line to an
          airport is otherwise easy to read as "it will be there" (D-050). One switch covers
          both legs (D-074): origin and destination come from the same schedule lookup and are
          exactly as trustworthy as each other, so there is nothing to choose between them. */}
      <Item on={showDestination} label="Filed route" k="showDestination"
            note={selected ? "origin + dest · dashed" : "needs a selected contact"} />
      <Item on={showDatum} label="Altitude slice" k="showDatum" note={sliceNote} />
      <Item on={showDropLines} label="Drop line" k="showDropLines" note={needsSel} />
      {/* D-060: selected/co-altitude/military are already labelled unconditionally - this only
          adds everyone else, dimmed so amber and near-white keep meaning something (D-029). The
          note gives the real count rather than a vague "clutter" warning, and says up front that
          a contact with no callsign shows its hex instead - that is correct, not a bug to hide. */}
      <Item on={showAllLabels} label="Identifiers" k="showAllLabels"
            note={showAllLabels
              ? `${aircraftCount} labelled · callsign or hex`
              : `${aircraftCount} contacts · clutters at wide zoom`} />
      {/* Political boundaries (D-063). States ON by default and cheap; counties OFF and, per
          Natural Earth, US-only - the note says so outright rather than letting an empty layer
          over Europe read as a broken toggle. Both thin out by camera distance, so "on" does
          not mean "always drawn": counties only resolve inside a few hundred km. */}
      <Item on={showStates} label="State lines" k="showStates" note="858 · worldwide" />
      <Item on={showCounties} label="County lines" k="showCounties"
            note={showCounties ? "3,619 · US only · close zoom" : "off · US only"} />
      <Item on={showPlaces} label="Places" k="showPlaces" note="airfields · cities" />
      {/* Small strips are OFF by default (D-052): 42,698 markers, and their data is a
          separate 3.5 MB file that is only fetched once this is switched on. The note says so,
          because a several-second first load would otherwise look like a broken toggle. */}
      {/* The single-file build has no sibling file to fetch, so the tier simply is not there.
          Said plainly, and the toggle is withheld rather than offered and left to fail. */}
      {showPlaces && isSingleFile && (
        <div className="lbl px-[10px] py-[2px]" style={{ fontSize: 9, color: "var(--off)" }}>
          Small fields — not in the single-file build
        </div>
      )}
      {showPlaces && !isSingleFile && (
        <Item on={showSmallAirports} label="Small fields" k="showSmallAirports"
              note={showSmallAirports ? "42,698 · loads on first use" : "off · +3.5 MB to enable"} />
      )}
      {/* Density scales how far out each place stays drawn. It cannot add places that were
          never built into places.json, so the labels are ranges, not counts. */}
      {showPlaces && (
        <div className="flex gap-[2px] mt-[3px]">
          {([[1, "STD"], [2, "MORE"], [4, "MAX"]] as const).map(([m, lab]) => (
            <button key={m} onClick={() => setPlaceDensity(m)}
              title={`place labels drawn to ${m}× their normal range`}
              style={{
                font: "inherit", fontSize: 9, letterSpacing: ".06em", flex: 1,
                background: "transparent", cursor: "pointer", padding: "2px 0",
                border: "1px solid var(--line-bright)", borderRadius: 0,
                color: placeDensity === m ? "var(--amber)" : "var(--off)",
              }}>{lab}</button>
          ))}
        </div>
      )}
      {/* The note is not decoration: it says the coverage is US-only and the frame is minutes
          old, so an empty layer reads as "no echo" or "outside coverage", never as broken. */}
      <Item on={showRadar} label="Weather radar" k="showRadar" note="NEXRAD · US · ~5 min old" />
    </div>
  );
}

/* ---------------- right: selected airfield ---------------- */

/**
 * Airfield detail (D-038). A magenta marker asserts significance, so it has to be
 * interrogable — otherwise the display is making a claim it will not explain.
 *
 * Everything here is verbatim from the build-time OurAirports extract. There is no network
 * call and nothing to wait for, so unlike the aircraft dossier there is no pending state:
 * a blank field means the SOURCE is blank, and it renders as an em-dash.
 */
export function PlacePanel({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const p = useStore((s) => s.selectedPlace);
  const selectPlace = useStore((s) => s.selectPlace);
  if (!p) return null;

  const text = (v: string) => (v && v.trim() ? v.trim() : DASH);

  return (
    <div
      className={`panel panel--dossier ${fullWidth ? "w-full" : "w-[344px]"} pointer-events-auto ${p.military ? "panel--mil" : ""}`}
      style={{ minHeight: 0, overflowY: "auto" }}
    >
      <div className="panel-h">
        <span style={{ color: p.military ? "var(--mil)" : "var(--cyan)", fontSize: 14, letterSpacing: ".1em" }}>
          {p.ident.toUpperCase()}
        </span>
        <button onClick={() => selectPlace(null)} className="lbl"
                style={{ background: "none", border: "none", cursor: "pointer" }}>×</button>
      </div>
      {/* Full width and wrapping: "Whiting Field Naval Air Station South Airport" does not
          fit a right-aligned value column, and truncating it would read as wrong data. */}
      <div className="px-[10px] py-[6px]" style={{ fontSize: 12, lineHeight: 1.35 }}>
        {text(p.name)}
      </div>
      <div className="py-1" style={{ borderTop: "1px solid var(--line)" }}>
        <div className={`row ${p.military ? "row--mil" : ""}`}>
          <span>Class</span><span>{p.military ? "MILITARY" : "CIVIL"}</span>
        </div>
        <div className="row"><span>Field</span><span>{p.large ? "LARGE" : "MEDIUM"}</span></div>
        <div className={`row ${p.iata ? "" : "row--dim"}`}>
          <span>IATA</span><span>{text(p.iata).toUpperCase()}</span>
        </div>
        <div className={`row ${p.municipality ? "" : "row--dim"}`} title={p.municipality || undefined}>
          <span>City</span><span style={{ fontSize: 12 }}>{text(p.municipality).slice(0, 24)}</span>
        </div>
        <div className={`row ${p.region || p.country ? "" : "row--dim"}`}>
          <span>Region</span>
          <span>{[p.region, p.country].filter(Boolean).join(" · ").toUpperCase() || DASH}</span>
        </div>
        <div className={`row ${p.elevationFt !== null ? "" : "row--dim"}`}>
          <span>Elev</span><span>{fmt(p.elevationFt, " FT")}</span>
        </div>
        <div className="row"><span>Lat</span><span>{p.lat.toFixed(4)}</span></div>
        <div className="row"><span>Lon</span><span>{p.lon.toFixed(4)}</span></div>
      </div>
      {/* The one thing this panel must not do is imply an authority we do not have. */}
      {p.military && (
        <div className="px-[10px] pb-[6px] lbl"
             style={{ color: "var(--amber)", fontSize: 9, letterSpacing: ".06em" }}>
          class inferred from field name · not an authoritative source
        </div>
      )}
      <div className="px-[10px] pb-[6px] lbl" style={{ fontSize: 9, letterSpacing: ".06em" }}>
        OurAirports · public domain
      </div>
    </div>
  );
}

/* ---------------- altitude colour legend ---------------- */

/**
 * The key to the icon hue ramp (D-029). Without it the colours are decoration; with it they
 * are a scale. Swatches are generated from the SAME function the icons use, so the legend
 * cannot drift out of sync with what is on screen.
 */
export function AltitudeLegend() {
  const stops = [0, 10000, 20000, 30000, 40000];
  return (
    <div className="panel pointer-events-auto" style={{ width: 148 }}>
      <div className="lbl px-[8px] pt-[6px]" style={{ fontSize: 9 }}>Altitude</div>
      <div className="px-[8px] pt-1 pb-[6px]">
        {stops.map((ft, i) => (
          <div key={ft} className="flex items-center gap-2" style={{ padding: "1px 0" }}>
            <span style={{
              width: 16, height: 7, background: altitudeColour(ft),
              display: "inline-block", flex: "none",
            }} />
            <span style={{ fontSize: 9, letterSpacing: ".06em", color: "var(--dim)",
                           fontVariantNumeric: "tabular-nums" }}>
              {i === stops.length - 1 ? `${(ft / 1000).toFixed(0)}K+` : `${(ft / 1000).toFixed(0)}K`}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2" style={{ padding: "3px 0 0",
             marginTop: 3, borderTop: "1px solid var(--line)" }}>
          <span style={{ width: 16, height: 7, background: "var(--mil)",
                         display: "inline-block", flex: "none" }} />
          <span style={{ fontSize: 9, letterSpacing: ".06em", color: "var(--mil)" }}>MIL</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- right: selected contact ---------------- */

/** Airport code for the dossier row; the full name goes in the hover title. */
/**
 * A human-readable origin/destination: the town, with the code after it.
 *
 * The codes were all we showed, and "OGG -> LAS" is only meaningful to someone who already knows
 * the codes. adsbdb gives us municipality and name for both ends, so we were already holding the
 * answer and hiding it in a hover title. Falls back to the code alone rather than inventing a
 * name, and to an em-dash when adsbdb knows nothing.
 */
function airportPlace(p: EnrichAirport | null | undefined): string {
  if (!p) return DASH;
  const code = p.iata ?? p.icao ?? null;
  const where = p.municipality ?? p.name ?? null;
  if (!where) return code ?? DASH;
  const short = where.length > 18 ? `${where.slice(0, 18)}\u2026` : where;
  return code ? `${short} ${code}` : short;
}

function airportTitle(p: EnrichAirport | null | undefined): string | undefined {
  if (!p) return undefined;
  return [p.name, p.municipality].filter(Boolean).join(" · ") || undefined;
}

// `useEnrichment` moved to ../data/useEnrichment: fetching it here made enrichment a side effect
// of rendering the chrome, which left the chrome-less `#probe` route unable to draw the FILED
// route legs. App owns the single call now.

/** Shared by the automatic load on selection and the explicit TRACK re-fetch. */
function fetchTrack(hex: string, quiet = false): Promise<TrackResult | null> {
  // A refresh is quiet: flipping the panel back to "…" every few seconds would make a track
  // that is working look like one that keeps failing.
  if (!quiet) useStore.getState().setTrack(null, true);
  return api.track(hex).catch(() => null);
}

/**
 * Load the selected contact's track, then keep it current.
 *
 * Selecting a contact loads the track: it is the reason most selections happen, and the TRACK
 * button sits far enough down a long dossier to be missed. TRACK remains an explicit re-read
 * and CLEAR still removes it - clearing does not re-run this, because the hex has not changed.
 *
 * The refresh matters as much as the auto-load. A track drawn once stops at the position the
 * contact held when it was read, so as the aircraft flies on, the line is left behind and
 * reads as though it stopped there - a plausible-looking wrong picture, which is exactly what
 * ground rule 1 exists to prevent.
 *
 * The backend ring buffer stays the single source. Re-reading it keeps the drawn path
 * identical to what EXPORT writes; appending live fixes client-side would quietly let the
 * picture and the export disagree. 5 s is the buffer's own sample interval (`sample_s`), so
 * asking faster could not return anything new.
 */
function useTrack(hex: string | null) {
  useEffect(() => {
    if (!hex) return;
    let cancelled = false;

    fetchTrack(hex).then((d) => { if (!cancelled) useStore.getState().setTrack(d, false); });

    const id = window.setInterval(() => {
      const st = useStore.getState();
      // CLEAR sets the track to null, and that has to stick until the operator asks again.
      // Reading the store rather than holding a flag means CLEAR needs no extra state.
      if (!st.track || st.track.hex.toLowerCase() !== hex.toLowerCase()) return;
      fetchTrack(hex, true).then((d) => {
        // A failed refresh keeps the last good track. A feed hiccup is not evidence that the
        // history we already read was wrong.
        if (cancelled || !d) return;
        // Re-check on the way back in, not just on the way out: CLEAR can land while this
        // request is in flight, and applying the reply then would undo it.
        const cur = useStore.getState().track;
        if (!cur || cur.hex.toLowerCase() !== hex.toLowerCase()) return;
        useStore.getState().setTrack(d, false);
      });
    }, 5000);

    return () => { cancelled = true; window.clearInterval(id); };
  }, [hex]);
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

    useStore.getState().setPhoto(null, true);
    api.photo(hex, registration)
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
  // The single-file build has no photos at all and must say THAT, not "unavailable" - which
  // would read as a passing outage and leave the operator waiting for something to come back.
  else if (isSingleFile) note = "No photos in the single-file build — needs a server";
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

/**
 * Outbound reference links. The gating lives in `externalLinks.ts` so it is under test; this
 * is only the rendering. Chips rather than a row of text: they match the TRACK / CLEAR / EXPORT
 * vocabulary already established two blocks up, and a 9px inline link is a poor target.
 */
function ExternalBlock({ hex, registration }: { hex: string | null; registration: string | null }) {
  const links = externalLinks(hex, registration);
  if (!links.length) return null;

  const chip = {
    font: "inherit", fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase" as const,
    background: "transparent", padding: "4px 6px", textDecoration: "none",
    border: "1px solid var(--line-bright)", color: "var(--cyan)", display: "inline-block",
  };

  return (
    <div className="py-1 px-[10px]" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="lbl pb-1" style={{ fontSize: 8, color: "var(--dim)" }}>
        External
      </div>
      <div className="flex flex-wrap gap-1">
        {links.map((l) => (
          // target=_blank so the console is never navigated away from - it is a live display.
          <a key={l.href} href={l.href} target="_blank" rel={l.rel} style={chip}>
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** "22 MIN" / "47 SEC" - the span actually covered, never the configured window. */
function spanLabel(s: number): string {
  if (s < 90) return `${Math.round(s)} SEC`;
  return `${Math.round(s / 60)} MIN`;
}

/**
 * Track controls. The readout beside them states the window the buffer really holds
 * (D-016) - a contact seen ninety seconds ago has a 90-second track, and saying "30 MIN"
 * because that is the buffer size would be inventing history.
 */
function TrackBlock({ hex, label }: { hex: string; label: string }) {
  const track = useStore((s) => s.track);
  const followHex = useStore((s) => s.followHex);
  const setFollow = useStore((s) => s.setFollow);
  const following = !!hex && followHex?.toLowerCase() === hex.toLowerCase();
  const pending = useStore((s) => s.trackPending);
  const mine = track && track.hex.toLowerCase() === hex.toLowerCase() ? track : null;

  // The track now loads on selection, so this is a re-read rather than the only way in. It
  // still earns its place: it is how CLEAR is undone.
  const load = () => {
    fetchTrack(hex).then((d) => useStore.getState().setTrack(d, false));
  };

  const btn = {
    font: "inherit", fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase" as const,
    background: "transparent", cursor: "pointer", padding: "4px 6px",
    border: "1px solid var(--line-bright)", borderRadius: 0, color: "var(--cyan)", flex: 1,
  };

  return (
    <div className="py-1 px-[10px]" style={{ borderTop: "1px solid var(--line)" }}>
      {/* FOLLOW sits on its own row above TRACK/CLEAR/EXPORT because it is a different KIND of
          action. Those three act on the recorded path; this one takes over the camera, which is
          the most surprising thing a control here can do - so it gets its own line, says which
          state it is in, and is the same button that releases it (D-076 Stage 3). */}
      <button
        style={{
          ...btn, width: "100%", flex: "none", marginBottom: 4, minHeight: 30,
          color: following ? "var(--amber)" : "var(--cyan)",
          borderColor: following ? "var(--amber)" : "var(--line-bright)",
        }}
        onClick={() => {
          if (following) { setFollow(null); return; }
          setFollow(hex);
          // Centre once on locking. The lock itself only TRANSLATES the camera by the contact's
          // own motion, so without this it would faithfully follow an aircraft that happened to
          // be off-screen.
          useStore.getState().requestFlyTo(hex);
        }}
        title={following
          ? "Release the camera"
          : "Lock the camera to this contact. It keeps your angle and zoom, and you can still drag."}
      >
        {following ? "◉ Following · release" : "Follow"}
      </button>
      <div className="flex gap-1">
        <button style={btn} onClick={load} disabled={pending}>
          {pending ? "…" : "Track"}
        </button>
        <button
          style={{ ...btn, color: mine ? "var(--cyan)" : "var(--dim)" }}
          onClick={() => useStore.getState().setTrack(null, false)}
          disabled={!mine}
        >
          Clear
        </button>
        <button
          style={{ ...btn, color: mine?.count ? "var(--cyan)" : "var(--dim)" }}
          onClick={() => mine && downloadGeoJSON(mine, label)}
          disabled={!mine?.count}
        >
          Export
        </button>
      </div>
      {mine && (
        <div className="lbl pt-1" style={{ fontSize: 9 }}>
          {mine.count === 0
            ? "No fixes buffered yet"
            : `${mine.count} fixes · ${spanLabel(mine.span_s)}${mine.truncated ? " · older discarded" : ""}`}
        </div>
      )}
      {mine && mine.count > 0 && (
        // The buffer is in-memory and starts when the contact came into range. Say so, so
        // a short track is never read as a short flight.
        <div className="lbl" style={{ fontSize: 8, color: "var(--dim)" }}>
          Buffered since contact came into range · max {Math.round(mine.buffer_window_s / 60)} min
        </div>
      )}
    </div>
  );
}

export function SelectionPanel({ fullWidth = false }: { fullWidth?: boolean } = {}) {
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
  // Enrichment is fetched in App, for every route - see ../data/useEnrichment.
  usePhoto(a?.hex ?? null, a?.registration ?? en?.aircraft?.registration ?? null);
  // Keyed on the SELECTED hex, not the feed object: a contact missing from one poll payload
  // must not tear the track down and reload it.
  useTrack(hex);
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

  // The same verdicts Globe.tsx uses to decide whether to draw each dashed leg, so the panel and
  // the globe can never disagree about whether the filed route is trustworthy (D-062, D-074).
  // A leg that vanishes from the globe without the panel saying why would be the silent version
  // of the false confidence this whole block exists to remove.
  const routeVerdict = checkFiledRoute({
    lat: a.lat,
    lon: a.lon,
    trackDeg: a.track_deg,
    altFt: a.alt_ft,
    destLat: enRoute?.destination?.lat ?? null,
    destLon: enRoute?.destination?.lon ?? null,
  });
  const originVerdict = checkFiledOrigin({
    lat: a.lat,
    lon: a.lon,
    trackDeg: a.track_deg,
    altFt: a.alt_ft,
    origLat: enRoute?.origin?.lat ?? null,
    origLon: enRoute?.origin?.lon ?? null,
  });

  const co = aircraft.filter(
    (o) => o.hex !== a.hex && o.alt_ft !== null && a.alt_ft !== null &&
      Math.abs(o.alt_ft - a.alt_ft) <= sepFt,
  );

  return (
    <div
      className={`panel panel--dossier ${fullWidth ? "w-full" : "w-[344px]"} pointer-events-auto ${a.military ? "panel--mil" : ""}`}
      // minHeight:0 is what actually lets a flex child shrink below its content height;
      // without it the panel refuses to scroll and overflows its container instead.
      style={{ minHeight: 0, overflowY: "auto" }}
    >
      <div className="panel-h">
        <span style={{ color: a.military ? "var(--mil)" : "var(--cyan)", fontSize: 14, letterSpacing: ".1em" }}>
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
          <span style={{ fontSize: 12 }}>{model ? model.slice(0, 32) : pending}</span>
        </div>
        <div className={`row ${operator ? "" : "row--dim"}`} title={operator ?? undefined}>
          <span>Operator</span>
          {/* 16 chars cut "AMERICAN AIRLINES" to "AMERICAN AIRLINE", which reads as wrong
              data rather than truncated data. Full value is in the hover title. */}
          <span style={{ fontSize: 12 }}>{operator ? operator.slice(0, 32) : pending}</span>
        </div>
        {/* FILED, not observed. adsbdb looks the route up from the callsign against a schedule,
            so a recycled or stale callsign yields another flight's route - and before D-062 this
            sat under a bare "Origin"/"Dest" label, reading with exactly the same authority as the
            live telemetry above it. The label carries the caveat now, not a tooltip. */}
        <div className={`row ${enRoute?.origin ? "" : "row--dim"}`}
             title={airportTitle(enRoute?.origin)}>
          <span>Filed orig</span>
          <span style={{ fontSize: 12 }}>{enRoute ? airportPlace(enRoute.origin) : pending}</span>
        </div>
        <div className={`row ${enRoute?.destination ? "" : "row--dim"}`}
             title={airportTitle(enRoute?.destination)}>
          <span>Filed dest</span>
          <span style={{ fontSize: 12 }}>{enRoute ? airportPlace(enRoute.destination) : pending}</span>
        </div>
        {enRoute && (enRoute.origin || enRoute.destination) && (
          <div className="px-[10px] pt-[2px] lbl" style={{ fontSize: 8, color: "var(--dim)" }}>
            Filed schedule · adsbdb · not live
          </div>
        )}
        {/* The cross-check. Only ever shown for a measured disagreement - "unchecked" is silent
            here rather than reassuring, because a note saying nothing is wrong when nothing was
            actually tested is the same false confidence this whole block exists to remove. */}
        {routeVerdict.state === "disagrees" && (
          <div className="px-[10px] pt-1 lbl" style={{ color: "var(--amber)", fontSize: 9 }}>
            Track {Math.round(a.track_deg ?? 0)}° vs {Math.round(routeVerdict.bearingDeg ?? 0)}° to
            filed dest — {Math.round(routeVerdict.offByDeg ?? 0)}° off at cruise.
            Filed route looks stale; line withdrawn.
          </div>
        )}
        {originVerdict.state === "disagrees" && (
          <div className="px-[10px] pt-1 lbl" style={{ color: "var(--amber)", fontSize: 9 }}>
            Track {Math.round(a.track_deg ?? 0)}° vs {Math.round(originVerdict.bearingDeg ?? 0)}°
            away from filed orig — {Math.round(originVerdict.offByDeg ?? 0)}° off at cruise.
            Filed route looks stale; line withdrawn.
          </div>
        )}
        {/* "Could not ask" is a different claim from "not known". Say which one it is. */}
        {enrichFailed && (
          <div className="px-[10px] pt-1 lbl" style={{ color: "var(--amber)", fontSize: 9 }}>
            adsbdb unavailable
          </div>
        )}
      </div>
      <TrackBlock hex={a.hex ?? ""} label={(a.flight || a.hex || "").trim()} />
      <PhotoBlock
        result={photo && photo.hex?.toUpperCase() === a.hex?.toUpperCase() ? photo : null}
        pending={photoPending}
      />
      <ExternalBlock hex={a.hex ?? null} registration={reg} />
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
    // `overflow-x-auto` and a tighter gap below `sm`, because this row is the ONLY thing that
    // overflowed the viewport at phone width: measured scrollWidth 501 against a 390 viewport,
    // with the `ml-auto` FPS chip sitting at right=501 (D-076). Six non-wrapping chips cannot fit
    // and must not push the whole PAGE sideways, so the bar scrolls within itself instead. That
    // keeps every chip - clipping status text to make it fit would hide feed state, which is the
    // one thing on this bar that must never be hidden.
    <div
      className="absolute left-0 right-0 bottom-0 flex items-center gap-2 sm:gap-5 px-3 overflow-x-auto"
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
      <span className="chip" style={{ color: mil ? "var(--mil)" : undefined }}>{mil} mil</span>
      <span className="chip">{home.label}</span>
      <span className="ml-auto chip">{fps} FPS · WebGL2</span>
    </div>
  );
}

/* ---------------- vertical exaggeration banner: mandatory while it is on ---------------- */

/**
 * Says out loud that the vertical axis is not real (D-075).
 *
 * Not a subtle chip. Someone walking up to the screen mid-session, or glancing at a shared
 * screenshot, must be able to tell that the geometry is distorted - otherwise an exaggerated
 * globe is exactly the plausible-looking untruth ground rule 1 exists to prevent. Amber, because
 * this project already uses amber for "pay attention to this", and it names the factor rather
 * than just warning, so the reader can undo the distortion mentally.
 *
 * Renders nothing at true scale. There is nothing to disclose then.
 */
export function VertScaleBanner({ top = 6 }: { top?: number } = {}) {
  const vertScale = useStore((s) => s.vertScale);
  const setVertScale = useStore((s) => s.setVertScale);
  if (vertScale === 1) return null;
  return (
    <div
      className="absolute left-1/2 lbl flex items-center gap-2"
      style={{
        // Passed in rather than fixed: the phone has a 52px top bar and a banner at 6 would
        // sit across the LIST control, which is precisely the collision this project has now
        // made twice.
        top, transform: "translateX(-50%)", zIndex: 50, pointerEvents: "auto",
        fontSize: 10, color: "var(--amber)",
        border: "1px solid var(--amber)", background: "rgba(5,7,10,.92)",
        padding: "4px 8px", whiteSpace: "nowrap",
      }}
      title="Geometry only. Every altitude readout is the aircraft's true altitude."
    >
      <span>VERTICAL {vertScale}x — NOT TRUE SCALE</span>
      <button
        onClick={() => setVertScale(1)}
        className="lbl"
        style={{
          font: "inherit", fontSize: 9, color: "var(--amber)", background: "transparent",
          border: "1px solid var(--amber)", padding: "2px 6px", cursor: "pointer",
          minHeight: 28,
        }}
      >
        RESET
      </button>
    </div>
  );
}

/* ---------------- attribution: mandatory, not optional ---------------- */

export function Attribution() {
  // Radar credit appears only while the layer is on: crediting a source we are not currently
  // drawing would be as misleading as failing to credit one we are.
  const showRadar = useStore((s) => s.showRadar);
  return (
    <div
      className="absolute right-3"
      style={{ bottom: 30, fontSize: 8, color: "var(--dim)", letterSpacing: ".06em" }}
    >
      GEBCO Compilation Group · aircraft data © airplanes.live (non-commercial) · airframe/route via adsbdb
      {" · places via OurAirports / Natural Earth (public domain)"}
      {/*
        Unconditional, unlike radar above. Radar is a drawn layer that can be switched off;
        geocoding is a standing capability, and a geocoded home keeps displaying an
        OpenStreetMap-derived NAME in the status bar long after the lookup. The policy's wording
        is "clearly display attribution as suitable for your medium" (D-069).
      */}
      {" · geocoding © OpenStreetMap contributors (ODbL)"}
      {showRadar && " · NEXRAD NOAA/NWS via Iowa State Mesonet"}
    </div>
  );
}
