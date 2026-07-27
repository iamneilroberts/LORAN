import { useEffect, useState } from "react";
import Globe from "./globe/Globe";
import {
  AltitudeLegend, Attribution, CursorReadout, PlacePanel, SelectionPanel,
  StatusBar, TrafficPanel, VertScaleBanner,
} from "./panels/Panels";
import { CameraCluster } from "./panels/CameraCluster";
import { GlanceView } from "./panels/GlanceView";
import { ProbeView } from "./panels/ProbeView";
import { useEnrichment } from "./data/useEnrichment";
import { currentView, isNarrow } from "./routes";
import { MobileMapChrome } from "./panels/MobileMapChrome";
import { PreferencesPanel } from "./panels/PreferencesPanel";
import { DEFAULT_THEME, useStore } from "./state/store";
import { applyTheme } from "./styles/palette";
import { api } from "./api";

/** Viewport-scoped-ish polling. The radius is a preference (`radiusNm` in the store, D-055),
 *  not a constant; the camera-derived radius lands with Phase 6's camera cluster. Backend
 *  clamps to the 250 nm upstream ceiling regardless of what is asked for. */
const POLL_MS = 2000;

/**
 * Exchange a `?t=` token for a session cookie, then scrub it out of the address bar (D-041).
 *
 * A link is the whole login, so the token necessarily arrives in the URL. Leaving it there
 * would park a live credential in browser history, in the title bar, and in whatever the next
 * person copies out of the address bar — so it is removed with replaceState the moment it has
 * been spent. Runs before the first poll, otherwise the first request races the cookie.
 */
async function claimSession(): Promise<void> {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("t");
  if (!token) return;
  try {
    await api.claimSession(token);
  } catch { /* the 401 state below is what tells the user, not a console message */ }
  url.searchParams.delete("t");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

/**
 * The locked state, and the way out of it (D-057).
 *
 * TWO different people read this panel. A guest was handed a link and only has to open it. The
 * owner, sitting at their own console on localhost, was never given a link at all - and the copy
 * that used to be here told the one person who can actually fix this to do the one thing they
 * cannot do. It is not a rare state for them either: session cookies are per-hostname, so
 * `localhost`, `127.0.0.1` and the tunnel hostname are three separate cookie jars, and clearing
 * cookies or opening a second browser empties whichever one they were using. So the paste field
 * comes first and the link is mentioned second.
 *
 * Lives in its own component so its input state is local to the locked panel: App's own effect
 * runs once with an empty dependency array and must not be re-run by keystrokes.
 */
function LockedPanel() {
  const [token, setToken] = useState("");
  // "failed" and "throttled" are separate because they are genuinely different situations and
  // saying "not recognised" to somebody who is actually rate-limited would be a lie. It leaks
  // nothing: the 429 is decided before the token is even looked at, so it says nothing about
  // whether the token was right.
  const [state, setState] = useState<"idle" | "sending" | "failed" | "throttled">("idle");

  async function submit() {
    // Trimmed here as well as in the backend so that the disabled check on the button agrees
    // with what would actually be sent - a field holding only a pasted newline is empty.
    const t = token.trim();
    if (!t || state === "sending") return;
    setState("sending");
    try {
      const r = await fetch("/api/session", {
        // POST, not the `?t=` GET the link path uses. A token typed in here has no reason to
        // appear in a URL, where uvicorn's access log - and Cloudflare's, once the tunnel is
        // live - would record it. Same-origin in both the Vite-proxy dev path and the
        // single-process serve path, so no CORS involvement either way.
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t }),
      });
      if (r.status === 429) { setState("throttled"); return; }
      if (!r.ok) { setState("failed"); return; }
      // The credential has been spent for a cookie; there is no reason for it to stay in the
      // DOM afterwards.
      setToken("");
      setState("idle");
      // This is what dismisses the panel. The poll loop is still running on its 5 s locked-out
      // cadence, so the globe fills in on its next tick with no page reload - up to five
      // seconds of blank, which is honest: nothing is drawn until real data actually arrives.
      useStore.getState().setAuthRequired(false);
    } catch {
      // A network failure and a rejected token are told apart by nobody here on purpose - both
      // mean "you are still locked out", and the panel already says the rest.
      setState("failed");
    }
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center"
         style={{ background: "rgba(5,7,10,0.86)" }}>
      <div className="panel pointer-events-auto" style={{ width: 380, padding: "18px 20px" }}>
        <div className="lbl" style={{ color: "var(--amber)", fontSize: 11 }}>
          Access token required
        </div>
        <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 10, lineHeight: 1.5 }}>
          This console is private. Paste your access token below, or open the full link you were
          given — it carries a <span style={{ color: "var(--cyan)" }}>?t=</span> token that this
          browser then remembers.
        </div>
        <div className="flex gap-[6px]" style={{ marginTop: 12 }}>
          <input
            /* A password field, not a text one: this UI gets screenshotted, and a token sitting
               in plain view of a camera or a shoulder is spent. */
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); setState("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="ACCESS TOKEN"
            /* Never offer to remember it and never send it to a spellcheck service. */
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="field flex-1"
            style={{
              font: "inherit", fontSize: 12, letterSpacing: "0.08em", padding: "5px 7px",
              background: "transparent", color: "var(--txt)", borderRadius: 0,
              border: "1px solid var(--line-bright)", outline: "none", minWidth: 0,
            }}
          />
          <button
            onClick={() => void submit()}
            disabled={!token.trim() || state === "sending"}
            style={{
              font: "inherit", fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase",
              padding: "4px 10px", borderRadius: 0, background: "transparent",
              cursor: token.trim() && state !== "sending" ? "pointer" : "default",
              border: "1px solid var(--line-bright)",
              color: token.trim() && state !== "sending" ? "var(--cyan)" : "var(--off)",
            }}
          >
            {state === "sending" ? "···" : "Enter"}
          </button>
        </div>
        {state === "failed" && (
          <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 8 }}>
            Token not recognised.
          </div>
        )}
        {state === "throttled" && (
          <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 8 }}>
            Too many attempts. Wait a minute, then try again.
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--off)", marginTop: 10 }}>
          Live traffic is not being shown. Nothing on screen is current.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const denied = useStore((s) => s.authRequired);

  // Which view this load lands on - see routes.ts for why width decides when no hash is given.
  // Tracked in state rather than read once so switching does not need a reload, and so neither
  // view can lock the other out.
  const [view, setView] = useState(currentView);
  // Tracked separately from `view`: on a phone the view is already "map" when you arrive from the
  // list, so a resize that changes only the width would not change `view` and would never
  // re-render the back control into existence.
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const recheck = () => { setView(currentView()); setNarrow(isNarrow()); };
    window.addEventListener("hashchange", recheck);
    // Resize matters only while auto-routed: rotating a tablet, or dragging a desktop window
    // narrow, should follow the viewport. Once a hash is set it wins, and `currentView` already
    // encodes that, so this listener is safe to leave attached in both cases.
    window.addEventListener("resize", recheck);
    return () => {
      window.removeEventListener("hashchange", recheck);
      window.removeEventListener("resize", recheck);
    };
  }, []);

  // Enrichment follows the SELECTION, not the chrome. Fetched here so it runs on every route -
  // the globe's FILED origin/destination legs (D-050, D-074) depend on it, and they are geometry,
  // not panel content. It used to live in Panels, which meant `#probe` could never draw them.
  const selected = useStore((s) =>
    s.selectedHex ? s.aircraft.find((a) => a.hex === s.selectedHex) : undefined);
  useEnrichment(selected?.hex ?? null, selected?.flight ?? null);

  // The persisted theme has to reach the document BEFORE Globe mounts and reads the palette,
  // or the first frame is painted from the default tokens and only corrects on the next change.
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme, DEFAULT_THEME);
  }, [theme]);

  useEffect(() => {
    let stop = false;

    claimSession().then(() => {
      if (stop) return;
      api.config()
        .then((c) => c?.home && useStore.getState().setHome(c.home))
        .catch(() => {});
      poll();
    });

    async function poll() {
      // Read fresh each tick rather than closing over a stale value - this effect runs once
      // (empty deps, below) so the loop must never restart when the preset changes. Reading
      // imperatively here means a new radius takes effect on the very next tick with no
      // teardown/recreate of the setTimeout chain.
      const { home, radiusNm } = useStore.getState();
      try {
        // Both sides of the merge here: the branch's `api` indirection, which is what lets the
        // single-file build swap in browser-direct upstream fetches, carrying main's `radiusNm`
        // preference (D-055) rather than the branch's fixed RADIUS_NM constant, which no longer
        // exists. Dropping either would silently undo a shipped feature.
        const { authRequired, payload } = await api.aircraft(home.lat, home.lon, radiusNm);
        // 401 is not a feed failure and must not be reported as one - the feeds are fine,
        // the caller is not authorised.
        if (authRequired) {
          useStore.getState().setAuthRequired(true);
          if (!stop) window.setTimeout(poll, 5000);
          return;
        }
        useStore.getState().setAuthRequired(false);
        const d = payload!;
        useStore.getState().setAircraft(d.aircraft ?? [], d.source, !!d.degraded, d.errors ?? []);
      } catch (e) {
        // Say it out loud in the status bar rather than leaving a stale frame looking live.
        useStore.getState().setFetchFailed([String(e)]);
      }
      if (!stop) window.setTimeout(poll, POLL_MS);
    }

    const health = window.setInterval(async () => {
      try {
        useStore.getState().setFeeds(await api.feeds());
      } catch { /* status bar already reflects the failed poll */ }
    }, 10000);

    return () => { stop = true; window.clearInterval(health); };
  }, []);

  // The list view (D-072). Returned BEFORE the globe, so `<Globe/>` never mounts and Cesium never
  // initialises on a phone - no WebGL context, no tile requests, no battery cost. Every effect
  // above still runs, so the poll that fills the store is unaffected; only the tree differs.
  if (view === "list") return <GlanceView />;

  // The probe mounts the REAL globe - a mock would measure the mock - but none of the console's
  // chrome, because that chrome is exactly what collapses at 390px (D-072) and an unreadable
  // instrument measures nothing.
  if (view === "probe") {
    return (
      <div className="relative h-full w-full">
        <Globe />
        <ProbeView />
      </div>
    );
  }

  // The phone gets a DIFFERENT chrome, not a shrunken one (D-076 Stage 2). Six panels at once is
  // a desktop answer; at 390px they overlap into an unreadable stack, and because panels are
  // translucent by spec the overlap ghosts through itself. Arriving from the list must land on
  // the aircraft, so this composition starts with the globe and almost nothing else.
  //
  // Stage 1 floated a LIST button at top-right here. It landed exactly on the dossier's own close
  // control and made the dossier undismissable - which is why LIST now lives inside the mobile
  // top bar instead of over the panel it was covering.
  if (narrow) {
    return (
      <div className="relative h-full w-full">
        <Globe />
        {/* MobileMapChrome renders the not-true-scale banner itself, so it can stand down while
            a sheet covers the globe. */}
        <MobileMapChrome />
        <StatusBar />
        {denied && <LockedPanel />}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Globe />
      {/* Chrome floats over the globe and never blocks it. */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Camera lives on the LEFT with the other controls (owner's call). It used to sit above
            the dossier and stole its height, which is why the photo fell below the fold. The
            right column is now the dossier's alone. LAYERS spent one revision (D-056) pulled all
            the way out into a PREFS overlay, on the theory that a docked panel always reclaims
            column height whether anyone is looking or not - true, but the fix overshot: the
            overlay's trigger turned out hard to find and low-contrast on the status bar, and a
            modal is a worse way to fiddle with settings than a pane in the same column as
            everything else being fiddled with. D-058 reverses it: PreferencesPanel is back here,
            docked, as a collapsing pane like TrafficPanel - which gets the same "costs nothing
            while shut" property the overlay was chasing, without the findability cost.

            ONE column spanning the viewport, not two opposing stacks. This used to be a `top-3`
            stack growing down and a `bottom-34` stack growing up, neither aware of the other, so
            on a short viewport the Layers panel simply drew over the legend. Because panels are
            translucent by spec, the result was Layers' text ghosting through the altitude swatches
            - which reads as a corrupted legend rather than as a layout problem. A shared height
            budget makes the collision impossible instead of unlikely; the right column has had one
            since the dossier grew a photo.

            `items-start` because every panel sets its own width (210/148/210/176) and stretching
            them to the widest would misalign the whole column. */}
        <div
          className="absolute left-3 top-3 flex flex-col gap-2 items-start"
          style={{ bottom: 34 }}
        >
          <TrafficPanel />
          <CameraCluster />
          {/* Below the camera controls, not above: both TrafficPanel and CameraCluster are
              things read or driven continuously, while preferences are visited occasionally to
              flip a setting and then left alone - collapsed, it is the cheapest thing in the
              column, so it costs almost nothing to place it here rather than at the very top. */}
          <PreferencesPanel />
          {/* Holds the legend and readout at the bottom, and collapses first when height is
              tight, so the controls above keep their natural size for as long as possible. */}
          <div className="flex-1" />
          <AltitudeLegend />
          <CursorReadout />
        </div>
        {/* Bounded to the viewport so the dossier - which grew a photo in Phase 2 - scrolls
            inside itself instead of running off the bottom edge behind the status bar. */}
        <div
          className="absolute right-3 top-3 flex flex-col gap-3 items-end"
          style={{ maxHeight: "calc(100% - 46px)" }}
        >
          {/* Mutually exclusive by construction - the store clears one when the other is
              set - so these never stack and fight for the bounded height. */}
          <SelectionPanel />
          <PlacePanel />
        </div>
      </div>
      <VertScaleBanner />
      <Attribution />
      <StatusBar />
      {/* An honest locked state. A blank globe with no explanation is indistinguishable from a
          dead feed, and would send the visitor to the owner asking the wrong question. */}
      {denied && <LockedPanel />}
    </div>
  );
}
