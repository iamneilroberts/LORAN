/**
 * Fetch the per-vessel detail (course / fresh fix) whenever the selected vessel changes.
 *
 * Lives beside useEnrichment for the same reason that one moved out of the panels: the answer
 * is GEOMETRY, not just panel content - a reported course is what lets the globe rotate the
 * selected vessel's hull - so it must run on every route that can select a vessel, chrome or
 * not. Call this ONCE per app.
 *
 * Only vessels with a real MMSI can be looked up (the upstream route is keyed on MMSI). A
 * vessel known only by MarineTraffic's internal id gets no fetch and no fake pending state -
 * the dossier renders em-dashes for what nobody can ask for.
 */
import { useEffect } from "react";

import { api } from "../api";
import { useStore, type VesselDetail } from "../state/store";

export function useVesselDetail(mmsi: string | null) {
  useEffect(() => {
    if (!mmsi) return;
    let cancelled = false;

    useStore.getState().setVesselDetail(null, true);
    api.vesselDetail(mmsi)
      .then((d: VesselDetail) => {
        if (cancelled) return;
        // Late reply for a deselected vessel: drop it. The layer and panel also verify the
        // MMSI, but not storing it at all is the cheaper guarantee.
        const cur = useStore.getState();
        const sel = cur.selectedVesselKey
          ? cur.vessels.find((v) => v.key === cur.selectedVesselKey)
          : undefined;
        if (sel?.mmsi !== mmsi) return;
        cur.setVesselDetail(d, false);
      })
      .catch((e) => {
        if (cancelled) return;
        useStore.getState().setVesselDetail(
          { mmsi, lat: null, lon: null, course_deg: null, course_source: null,
            speed_kt: null, pos_ts: null, errors: [String(e)] }, false,
        );
      });

    return () => { cancelled = true; };
  }, [mmsi]);
}
