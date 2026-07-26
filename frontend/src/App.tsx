import { useEffect } from "react";
import Globe from "./globe/Globe";
import {
  AltitudeLegend, Attribution, CursorReadout, LayerCluster, PlacePanel, SelectionPanel,
  StatusBar, TrafficPanel,
} from "./panels/Panels";
import { CameraCluster } from "./panels/CameraCluster";
import { useStore } from "./state/store";

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
    await fetch(`/api/session?t=${encodeURIComponent(token)}`);
  } catch { /* the 401 state below is what tells the user, not a console message */ }
  url.searchParams.delete("t");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export default function App() {
  const denied = useStore((s) => s.authRequired);

  useEffect(() => {
    let stop = false;

    claimSession().then(() => {
      if (stop) return;
      fetch("/api/config")
        .then((r) => r.json())
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
        const r = await fetch(
          `/api/aircraft?lat=${home.lat}&lon=${home.lon}&radius=${radiusNm}`,
        );
        // 401 is not a feed failure and must not be reported as one - the feeds are fine,
        // the caller is not authorised.
        if (r.status === 401) {
          useStore.getState().setAuthRequired(true);
          if (!stop) window.setTimeout(poll, 5000);
          return;
        }
        useStore.getState().setAuthRequired(false);
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        useStore.getState().setAircraft(d.aircraft ?? [], d.source, !!d.degraded, d.errors ?? []);
      } catch (e) {
        // Say it out loud in the status bar rather than leaving a stale frame looking live.
        useStore.getState().setFetchFailed([String(e)]);
      }
      if (!stop) window.setTimeout(poll, POLL_MS);
    }

    const health = window.setInterval(async () => {
      try {
        const r = await fetch("/api/health");
        const d = await r.json();
        useStore.getState().setFeeds(d?.feeds?.adsb ?? []);
      } catch { /* status bar already reflects the failed poll */ }
    }, 10000);

    return () => { stop = true; window.clearInterval(health); };
  }, []);

  return (
    <div className="relative h-full w-full">
      <Globe />
      {/* Chrome floats over the globe and never blocks it. */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Camera and Layers live on the LEFT with the other controls (owner's call). They used
            to sit above the dossier and stole its height, which is why the photo fell below the
            fold. The right column is now the dossier's alone.

            ONE column spanning the viewport, not two opposing stacks. This used to be a `top-3`
            stack growing down and a `bottom-34` stack growing up, neither aware of the other, so
            on a short viewport the Layers panel simply drew over the legend. Because panels are
            translucent by spec, the result was Layers' text ghosting through the altitude swatches
            - which reads as a corrupted legend rather than as a layout problem. A shared height
            budget makes the collision impossible instead of unlikely; the right column has had one
            since the dossier grew a photo.

            `items-start` because every panel sets its own width (210/148/176) and stretching them
            to the widest would misalign the whole column. */}
        <div
          className="absolute left-3 top-3 flex flex-col gap-2 items-start"
          style={{ bottom: 34 }}
        >
          <TrafficPanel />
          <CameraCluster />
          <LayerCluster />
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
      <Attribution />
      <StatusBar />
      {/* An honest locked state. A blank globe with no explanation is indistinguishable from a
          dead feed, and would send the visitor to the owner asking the wrong question. */}
      {denied && (
        <div className="absolute inset-0 flex items-center justify-center"
             style={{ background: "rgba(5,7,10,0.86)" }}>
          <div className="panel pointer-events-auto" style={{ width: 380, padding: "18px 20px" }}>
            <div className="lbl" style={{ color: "var(--amber)", fontSize: 11 }}>
              Access token required
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 10, lineHeight: 1.5 }}>
              This console is private. Open the full link you were given — it carries a
              one-time <span style={{ color: "var(--cyan)" }}>?t=</span> token that this browser
              then remembers.
            </div>
            <div style={{ fontSize: 11, color: "var(--off)", marginTop: 10 }}>
              Live traffic is not being shown. Nothing on screen is current.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
