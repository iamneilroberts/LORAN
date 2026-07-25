import { useEffect } from "react";
import Globe from "./globe/Globe";
import {
  AltitudeLegend, Attribution, CursorReadout, LayerCluster, PlacePanel, SelectionPanel,
  StatusBar, TrafficPanel,
} from "./panels/Panels";
import { CameraCluster } from "./panels/CameraCluster";
import { useStore } from "./state/store";

/** Viewport-scoped-ish polling. Phase 1 polls a fixed radius around home; the camera-derived
 *  radius lands with Phase 6's camera cluster. Backend clamps to the 250 nm upstream ceiling. */
const RADIUS_NM = 120;
const POLL_MS = 2000;

export default function App() {
  useEffect(() => {
    let stop = false;

    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => c?.home && useStore.getState().setHome(c.home))
      .catch(() => {});

    async function poll() {
      const { home } = useStore.getState();
      try {
        const r = await fetch(
          `/api/aircraft?lat=${home.lat}&lon=${home.lon}&radius=${RADIUS_NM}`,
        );
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        useStore.getState().setAircraft(d.aircraft ?? [], d.source, !!d.degraded, d.errors ?? []);
      } catch (e) {
        // Say it out loud in the status bar rather than leaving a stale frame looking live.
        useStore.getState().setFetchFailed([String(e)]);
      }
      if (!stop) window.setTimeout(poll, POLL_MS);
    }
    poll();

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
        <div className="absolute left-3 top-3"><TrafficPanel /></div>
        <div className="absolute left-3 flex flex-col gap-2" style={{ bottom: 34 }}>
          <AltitudeLegend />
          <CursorReadout />
        </div>
        {/* Bounded to the viewport so the dossier - which grew a photo in Phase 2 - scrolls
            inside itself instead of running off the bottom edge behind the status bar. */}
        <div
          className="absolute right-3 top-3 flex flex-col gap-3 items-end"
          style={{ maxHeight: "calc(100% - 46px)" }}
        >
          <CameraCluster />
          <LayerCluster />
          {/* Mutually exclusive by construction - the store clears one when the other is
              set - so these never stack and fight for the bounded height. */}
          <SelectionPanel />
          <PlacePanel />
        </div>
      </div>
      <Attribution />
      <StatusBar />
    </div>
  );
}
