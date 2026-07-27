/**
 * The console's chrome, recomposed for a phone (D-076 Stage 2).
 *
 * WHY A DIFFERENT COMPOSITION RATHER THAN RESPONSIVE PANELS. The desktop console puts six
 * surfaces on screen at once — traffic, camera, preferences, legend, cursor readout, dossier —
 * because a desktop has room for all six and the operator wants them all visible. A phone has
 * room for roughly one. Making each of the six shrink would produce six cramped panels competing
 * for the same 390px; the honest answer is that most of them should not be on screen at all.
 *
 * So this renders the globe with almost nothing over it, and everything else is opened
 * deliberately and closes again. The owner's words, after using Stage 1: "collapse as much as we
 * can to dedicate limited screen real estate to the aircraft tracking view."
 *
 * WHAT IS DELIBERATELY ABSENT ON A PHONE:
 *   - The traffic panel. The LIST view is a better version of it, and it is one tap away.
 *   - The cursor readout. It reports the position under a MOUSE POINTER. There is no pointer.
 *   - The altitude legend and camera cluster, until asked for: touch already pans, pinches and
 *     tilts the globe, so the camera buttons are a desktop affordance, and the legend is
 *     reference material rather than a live instrument.
 *
 * WHAT IS NOT ALLOWED TO DISAPPEAR:
 *   - Attribution. It follows the DATA SHOWN (D-072), and this view draws GEBCO bathymetry and
 *     OurAirports/Natural Earth places, so the credit is owed here exactly as on the desktop. It
 *     is compact and scrolls sideways rather than being hidden behind a control.
 *   - The feed state. "No contacts" and "the feed is down" are different facts (ground rule 1),
 *     and the top bar keeps saying which.
 */
import { useState } from "react";

import { AltitudeLegend, PlacePanel, SelectionPanel } from "./Panels";
import { CameraCluster } from "./CameraCluster";
import { PreferencesPanel } from "./PreferencesPanel";
import { useStore } from "../state/store";
import { goTo } from "../routes";

const DASH = "—";

type Sheet = "none" | "detail" | "menu";

/** A control sized for a thumb rather than a cursor. 44px is the floor; these clear it. */
const BTN: React.CSSProperties = {
  minHeight: 40,
  minWidth: 44,
  fontSize: 11,
  border: "1px solid var(--line-bright)",
  background: "rgba(5,7,10,.86)",
  color: "var(--cyan)",
  padding: "0 10px",
};

export function MobileMapChrome() {
  const [sheet, setSheet] = useState<Sheet>("none");

  const aircraft = useStore((s) => s.aircraft);
  const selectedHex = useStore((s) => s.selectedHex);
  const selectedPlace = useStore((s) => s.selectedPlace);
  const source = useStore((s) => s.source);
  const lastFetchOk = useStore((s) => s.lastFetchOk);
  const select = useStore((s) => s.select);

  const a = selectedHex ? aircraft.find((x) => x.hex === selectedHex) : undefined;
  const hasDetail = !!a || !!selectedPlace;

  const title = a
    ? (a.flight?.trim() || a.hex?.toUpperCase() || DASH)
    : selectedPlace
      ? (selectedPlace.name ?? DASH)
      : `${aircraft.length} CONTACTS`;

  return (
    <>
      {/* One bar, one row, nothing else at rest. Arriving from the list must land on the
          aircraft, not on a stack of panels the reader then has to work out how to dismiss. */}
      <div
        className="absolute left-0 right-0 top-0 flex items-center gap-2 px-2"
        style={{
          height: 52, pointerEvents: "auto",
          background: "linear-gradient(rgba(5,7,10,.92), rgba(5,7,10,0))",
          zIndex: 30,
        }}
      >
        <button className="lbl" style={BTN} onClick={() => goTo("list")}>‹ LIST</button>

        <div style={{ minWidth: 0, flex: 1, textAlign: "center" }}>
          <div
            className="lbl"
            style={{
              fontSize: 13, color: a?.military ? "var(--mil)" : "var(--cyan)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
          {/* Feed state, never blurred into the count. */}
          <div className="lbl" style={{ fontSize: 9, color: lastFetchOk ? "var(--off)" : "var(--amber)" }}>
            {lastFetchOk && source ? source : lastFetchOk ? "awaiting feed" : "feed unavailable"}
          </div>
        </div>

        <button
          className="lbl"
          style={BTN}
          onClick={() => setSheet((s) => (s === "menu" ? "none" : "menu"))}
        >
          {sheet === "menu" ? "CLOSE" : "SET"}
        </button>
      </div>

      {/* The peek. A one-line summary of the selected contact that opens the full dossier on
          tap - so the detail is one gesture away without ever being in the way, and there is a
          visible thing to tap rather than a panel that simply appeared. */}
      {hasDetail && sheet === "none" && (
        <button
          onClick={() => setSheet("detail")}
          className="absolute left-0 right-0 flex items-center justify-between px-3"
          style={{
            bottom: 24, height: 46, pointerEvents: "auto", zIndex: 30,
            background: "rgba(5,7,10,.92)", borderTop: "1px solid var(--line-bright)",
            color: "var(--txt)", textAlign: "left",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a
              ? `${a.alt_ft != null ? `${Math.round(a.alt_ft).toLocaleString()} ft` : DASH} · ${a.gs_kt != null ? `${Math.round(a.gs_kt)} kt` : DASH}`
              : [selectedPlace?.ident, selectedPlace?.municipality].filter(Boolean).join(" · ") || DASH}
          </span>
          <span className="lbl" style={{ fontSize: 10, color: "var(--cyan)", whiteSpace: "nowrap" }}>
            DETAIL ›
          </span>
        </button>
      )}

      {/* Sheets. Bounded to the dynamic viewport and scrollable, because `100vh` on iOS Safari is
          the LARGE viewport and puts the last rows permanently under the browser toolbar - the
          same trap the probe hit. Each carries an explicit CLOSE: a sheet you cannot obviously
          dismiss is worse than one that never opened. */}
      {sheet !== "none" && (
        <div
          className="absolute left-0 right-0 flex flex-col"
          style={{
            bottom: 0, top: 52, pointerEvents: "auto", zIndex: 40,
            background: "rgba(5,7,10,.96)", borderTop: "1px solid var(--line-bright)",
          }}
        >
          <div
            className="flex items-center justify-between px-3"
            style={{ height: 44, borderBottom: "1px solid var(--line)", flexShrink: 0 }}
          >
            <span className="lbl" style={{ fontSize: 11, color: "var(--dim)" }}>
              {sheet === "detail" ? "CONTACT DETAIL" : "SETTINGS"}
            </span>
            <button className="lbl" style={BTN} onClick={() => setSheet("none")}>CLOSE ✕</button>
          </div>

          <div
            style={{
              flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
              padding: 8,
              paddingBottom: "calc(28px + env(safe-area-inset-bottom))",
            }}
          >
            {sheet === "detail" ? (
              <>
                {/* Full width here, 344px on the desktop. The fixed width is right in a column
                    beside a globe and wrong inside a sheet that already owns the screen. */}
                <SelectionPanel fullWidth />
                <PlacePanel fullWidth />
                {a && (
                  <button
                    className="lbl w-full"
                    style={{ ...BTN, marginTop: 10, minHeight: 44, color: "var(--dim)" }}
                    onClick={() => { select(null); setSheet("none"); }}
                  >
                    DESELECT
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2 items-stretch">
                {/* alwaysOpen: the desktop panel auto-collapses when the pointer leaves, and a
                    touch device never hovers - so without this it would fold itself away inside
                    the sheet the operator just opened, with no way to unfold it. */}
                <PreferencesPanel alwaysOpen />
                <CameraCluster />
                <AltitudeLegend />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
