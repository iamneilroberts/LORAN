/**
 * The auto-collapse DECISION for the air-traffic panel (D-056), pulled out of the component so
 * it is a plain function - vitest's `node` environment (see vitest.config.ts) has no DOM and
 * cannot render React, but data in, data out needs nothing more than that.
 *
 * The rule this exists to hold the line on: the collapse is TIME-based, never DATA-based.
 * `hasContacts` decides only the honest empty-state text, never whether the panel is collapsed -
 * a panel that tidied itself away because the contact list emptied out would make a dead feed
 * look like a clean UI, which is the same failure mode ground rule 1 forbids for invented data.
 */
export interface TrafficPanelSections {
  /** Per-operator rows with their bars, and the MIL / ALL filter buttons. */
  controls: boolean;
  /** "Filtered · N of M shown" amber warning. Must survive collapse: hiding it would let the
   *  globe under-report traffic without saying so - non-negotiable, per the owner. */
  filterWarning: boolean;
  /** "No contacts in range" / "Awaiting feed". Must also survive collapse, for the same reason:
   *  a collapsed panel must never make "no data" look like "tidied away". */
  emptyState: boolean;
  /** The SEA TRAFFIC block. */
  seaTraffic: boolean;
}

export function trafficPanelSections(args: {
  collapsed: boolean;
  filtering: boolean;
  hasContacts: boolean;
}): TrafficPanelSections {
  return {
    controls: !args.collapsed,
    filterWarning: args.filtering,
    emptyState: !args.hasContacts,
    seaTraffic: !args.collapsed,
  };
}

/** Collapse after this long without a hover. */
export const COLLAPSE_AFTER_MS = 8000;

/**
 * Hover has to hold for this long before expanding. Without the delay the panel pops open every
 * time the mouse sweeps toward an aircraft on the left side of the globe, which is a real path
 * for the cursor and not a rare accident.
 */
export const HOVER_EXPAND_DELAY_MS = 250;
