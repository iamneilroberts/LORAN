/**
 * Fetch adsbdb detail whenever the selected contact changes.
 *
 * A reply that arrives after the user has moved on is dropped: the store also holds the hex the
 * reply belongs to, and consumers refuse to render a mismatch. Showing one aircraft's
 * registration under another's callsign is exactly the kind of plausible-looking wrong data
 * ground rule 1 exists to prevent.
 *
 * WHY IT LIVES HERE RATHER THAN IN THE DOSSIER. It used to sit inside `Panels.tsx`, which made
 * enrichment a side effect of rendering the chrome. That was invisible on the desktop, where the
 * chrome is always mounted, and wrong everywhere else: the `#probe` route mounts the globe
 * without any chrome, so `enrichment` stayed null forever and the FILED origin/destination legs
 * (D-050, D-074) could never draw - even though they are globe geometry that has nothing to do
 * with the panel. Enrichment is store data keyed on the selection, so it is fetched wherever the
 * selection lives, and every route that can select a contact gets the same globe.
 *
 * Call this ONCE per app. Two callers would double-fetch on every selection.
 */
import { useEffect } from "react";

import { api } from "../api";
import { useStore, type Enrichment } from "../state/store";

export function useEnrichment(hex: string | null, callsign: string | null) {
  useEffect(() => {
    if (!hex) return;
    let cancelled = false;

    useStore.getState().setEnrichment(null, true);
    api.enrich(hex, callsign)
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
