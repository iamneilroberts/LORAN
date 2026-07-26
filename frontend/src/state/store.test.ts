/**
 * Two claims this suite holds `radiusNm` to.
 *
 * First: `setRadiusNm` is a real clamp, not a pass-through with the name of one. A corrupt or
 * hand-edited `localStorage` value must not be able to put the UI into a state none of its
 * preset buttons can represent - that clamp is what stands between a bad value and a request
 * the backend has to reject or silently reinterpret. Every value the RANGE_PRESETS_NM buttons
 * can actually send must survive the clamp unchanged, or a preset could drift outside its own
 * range and its button would stop reflecting what got stored (the active-state highlight in
 * Panels.tsx compares by strict equality).
 *
 * Second: the persist migration is additive, not a replacement. `from < 3` has to add
 * `radiusNm` without discarding what the `from < 2` step already did - migrations chain, they
 * do not each start from a blank slate. A v1 payload run through `migrate` must show fields
 * from BOTH steps, or a future version bump quietly drops something D-047 already fixed.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME, isThemeName, MAX_RADIUS_NM, migratePrefs, RANGE_PRESETS_NM, THEMES, useStore,
} from "./store";

describe("setRadiusNm", () => {
  it("clamps a value above the ceiling down to MAX_RADIUS_NM", () => {
    useStore.getState().setRadiusNm(9999);
    expect(useStore.getState().radiusNm).toBe(MAX_RADIUS_NM);
  });

  it("clamps a value below the floor up to 10", () => {
    useStore.getState().setRadiusNm(1);
    expect(useStore.getState().radiusNm).toBe(10);
  });

  it("accepts every shipped preset unchanged", () => {
    // The one that catches a preset drifting outside the clamp: if RANGE_PRESETS_NM ever
    // gained a value the clamp does not allow, the corresponding button would light up for a
    // number the store did not actually store.
    for (const nm of RANGE_PRESETS_NM) {
      useStore.getState().setRadiusNm(nm);
      expect(useStore.getState().radiusNm).toBe(nm);
    }
  });
});

describe("migratePrefs", () => {
  it("from < 3 adds radiusNm: 120 without touching an already-current payload", () => {
    const migrated = migratePrefs({ showDatum: false, projMinutes: 5 }, 2);
    expect(migrated.radiusNm).toBe(120);
    expect(migrated.showDatum).toBe(false);
    expect(migrated.projMinutes).toBe(5);
  });

  it("from < 4 adds showAllLabels: false without touching an already-current payload", () => {
    const migrated = migratePrefs({ radiusNm: 180 }, 3);
    expect(migrated.showAllLabels).toBe(false);
    expect(migrated.radiusNm).toBe(180);
  });

  it("from < 5 adds the boundary toggles without touching an already-current payload", () => {
    // States ON, counties OFF - the shipped defaults, and they must survive the migration
    // rather than arriving `undefined`, which would render the toggle as off while the layer
    // had never actually been asked for either way (D-063).
    const migrated = migratePrefs({ showAllLabels: true }, 4);
    expect(migrated.showStates).toBe(true);
    expect(migrated.showCounties).toBe(false);
    expect(migrated.showAllLabels).toBe(true);
  });

  it("from < 6 adds the theme without touching an already-current payload", () => {
    const migrated = migratePrefs({ showStates: false }, 5);
    expect(migrated.theme).toBe(DEFAULT_THEME);
    expect(migrated.showStates).toBe(false);
  });

  it("from < 7 adds a null home override, so nothing changes for an existing browser", () => {
    const migrated = migratePrefs({ theme: "slate" }, 6);
    expect(migrated.homeOverride).toBeNull();
    expect(migrated.theme).toBe("slate");
  });

  it("chains: a v1 payload picks up the v2, v3, v4 and v5 fields, not just the newest", () => {
    const migrated = migratePrefs({ showDatum: true }, 1);
    // v2 step (D-047) - proves the chain did not break when v3 and v4 were added on top of it.
    expect(migrated.showDatum).toBe(false);
    expect(migrated.showProjection).toBe(true);
    expect(migrated.projMinutes).toBe(5);
    expect(migrated.projSpreadDeg).toBe(10);
    // v3 step (D-055).
    expect(migrated.radiusNm).toBe(120);
    // v4 step (D-060).
    expect(migrated.showAllLabels).toBe(false);
    // v5 step (D-063).
    expect(migrated.showStates).toBe(true);
    expect(migrated.showCounties).toBe(false);
    // v6 step (D-066).
    expect(migrated.theme).toBe(DEFAULT_THEME);
    // v7 step (D-068).
    expect(migrated.homeOverride).toBeNull();
  });
});

describe("themes", () => {
  it("ships two dark and two mid-tone, which is what was asked for", () => {
    expect(THEMES.filter((t) => t.kind === "dark")).toHaveLength(2);
    expect(THEMES.filter((t) => t.kind === "mid")).toHaveLength(2);
  });

  it("defaults to a theme it actually ships", () => {
    expect(isThemeName(DEFAULT_THEME)).toBe(true);
  });

  it("names are unique, so the chooser cannot render two identical buttons", () => {
    const names = THEMES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("rejects a theme name this build does not ship", () => {
    // A hand-edited or downgraded localStorage must not leave the document carrying a
    // data-theme with no matching block, which would render half-styled.
    for (const bad of ["solarized", "", "MIDNIGHT", null, 7, undefined]) {
      expect(isThemeName(bad)).toBe(false);
    }
  });

  it("setTheme falls back to the default rather than storing an unknown name", () => {
    const store = useStore.getState();
    store.setTheme("carbon");
    expect(useStore.getState().theme).toBe("carbon");
    store.setTheme("nonesuch" as never);
    expect(useStore.getState().theme).toBe(DEFAULT_THEME);
    store.setTheme(DEFAULT_THEME);
  });
});

describe("home override", () => {
  const server = { lat: 30.6944, lon: -88.0399, label: "MOBILE, AL" };

  it("uses the configured home until an override is set", () => {
    useStore.getState().setHomeOverride(null);
    useStore.getState().setHome(server);
    expect(useStore.getState().home).toEqual(server);
    expect(useStore.getState().homeOverride).toBeNull();
  });

  it("labels an override by coordinates, never by a place name", () => {
    useStore.getState().setHomeOverride({ lat: 47.6062, lon: -122.3321 });
    expect(useStore.getState().home.label).toBe("47.61N 122.33W");
  });

  it("does NOT let a later config fetch clobber an explicit override", () => {
    // The regression that would make a remote viewer's chosen home silently snap back to the
    // server's every time /api/config replied.
    useStore.getState().setHomeOverride({ lat: 47.6062, lon: -122.3321 });
    useStore.getState().setHome(server);
    expect(useStore.getState().home.lat).toBeCloseTo(47.6062, 4);
    expect(useStore.getState().serverHome).toEqual(server);
  });

  it("resets to the configured home when the override is cleared", () => {
    useStore.getState().setHomeOverride({ lat: 47.6062, lon: -122.3321 });
    useStore.getState().setHomeOverride(null);
    expect(useStore.getState().home).toEqual(server);
  });

  it("refuses an impossible position rather than pointing the camera at it", () => {
    useStore.getState().setHomeOverride(null);
    useStore.getState().setHome(server);
    useStore.getState().setHomeOverride({ lat: 91, lon: 0 });
    expect(useStore.getState().homeOverride).toBeNull();
    expect(useStore.getState().home).toEqual(server);
  });
});
