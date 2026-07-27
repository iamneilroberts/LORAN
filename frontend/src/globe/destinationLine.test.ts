/**
 * `levelArc` exists because Cesium arcs across the SURFACE: hand it two points and
 * ArcType.GEODESIC and a long leg sags through the terrain between samples. The line has to hold
 * the contact's altitude for its whole length, because a line that descends toward the runway
 * would draw a descent profile we have never computed (D-050).
 *
 * So the test that matters most here is the boring one: every point is at the same height.
 */
import { Cartographic, Cartesian3, EntityCollection, JulianDate, type Viewer } from "cesium";
import { describe, expect, it } from "vitest";

import {
  DEST_PREFIX,
  ORIGIN_PREFIX,
  clearDestination,
  clearOrigin,
  levelArc,
  upsertDestination,
  upsertOrigin,
} from "./destinationLine";

const R_EARTH = 6371000;

function carto(c: Cartesian3) {
  const g = Cartographic.fromCartesian(c);
  return {
    lat: (g.latitude * 180) / Math.PI,
    lon: (g.longitude * 180) / Math.PI,
    height: g.height,
  };
}

function haversine(a: Cartesian3, b: Cartesian3): number {
  const ca = Cartographic.fromCartesian(a);
  const cb = Cartographic.fromCartesian(b);
  const dφ = cb.latitude - ca.latitude;
  const dλ = cb.longitude - ca.longitude;
  const h = Math.sin(dφ / 2) ** 2
    + Math.cos(ca.latitude) * Math.cos(cb.latitude) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Mobile, AL -> Las Vegas (KLAS): the real leg this was first verified against.
const MOB = { lat: 30.6944, lon: -88.0399 };
const LAS = { lat: 36.0801, lon: -115.152 };

describe("levelArc", () => {
  it("holds the given height at EVERY point, not just the ends", () => {
    // This is the honesty property: a sagging line is a descent profile we never computed.
    const h = 12367;
    const arc = levelArc(MOB.lat, MOB.lon, LAS.lat, LAS.lon, h, 64);
    for (const p of arc) expect(carto(p).height).toBeCloseTo(h, 3);
  });

  it("starts at the origin and ends at the destination", () => {
    const arc = levelArc(MOB.lat, MOB.lon, LAS.lat, LAS.lon, 10000, 32);
    const first = carto(arc[0]);
    const last = carto(arc[arc.length - 1]);
    expect(first.lat).toBeCloseTo(MOB.lat, 4);
    expect(first.lon).toBeCloseTo(MOB.lon, 4);
    expect(last.lat).toBeCloseTo(LAS.lat, 4);
    expect(last.lon).toBeCloseTo(LAS.lon, 4);
  });

  it("returns steps + 1 points", () => {
    expect(levelArc(MOB.lat, MOB.lon, LAS.lat, LAS.lon, 0, 16)).toHaveLength(17);
    expect(levelArc(MOB.lat, MOB.lon, LAS.lat, LAS.lon, 0, 64)).toHaveLength(65);
  });

  it("follows the great circle, not a straight line in lat/lon", () => {
    // A naive lat/lon interpolation would put the midpoint on the rhumb line. On a leg this
    // long the great circle bows measurably north of it - that difference IS the correctness.
    const arc = levelArc(MOB.lat, MOB.lon, LAS.lat, LAS.lon, 0, 64);
    const mid = carto(arc[32]);
    const naiveLat = (MOB.lat + LAS.lat) / 2;
    expect(mid.lat).toBeGreaterThan(naiveLat + 0.3);
  });

  it("spaces its points evenly along the arc", () => {
    const arc = levelArc(MOB.lat, MOB.lon, LAS.lat, LAS.lon, 0, 32);
    const hops: number[] = [];
    for (let i = 1; i < arc.length; i++) hops.push(haversine(arc[i - 1], arc[i]));
    const min = Math.min(...hops);
    const max = Math.max(...hops);
    expect(max - min).toBeLessThan(max * 0.02);
  });

  it("degenerates safely when origin and destination coincide", () => {
    // Same airport both ends: must not divide by a zero angular distance.
    const arc = levelArc(MOB.lat, MOB.lon, MOB.lat, MOB.lon, 3000, 64);
    expect(arc).toHaveLength(1);
    expect(carto(arc[0]).height).toBeCloseTo(3000, 3);
  });

  it("handles a leg that crosses the antimeridian", () => {
    // Tokyo -> Los Angeles. Every point must stay on the globe and hold height; a naive
    // longitude lerp would swing the wrong way round the planet.
    const arc = levelArc(35.55, 139.78, 33.94, -118.41, 11000, 32);
    for (const p of arc) {
      const c = carto(p);
      expect(c.height).toBeCloseTo(11000, 3);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
    }
    // The Pacific great circle runs north of both endpoints, not down through the tropics.
    const lats = arc.map((p) => carto(p).lat);
    expect(Math.max(...lats)).toBeGreaterThan(35.55);
  });
});

/**
 * The REUSE path, which is the whole of the flashing fix (D-074).
 *
 * The line used to clear() and re-add its entities on every call, and Globe.tsx calls it on
 * essentially every 2 s poll: measured against live data, 34 of 35 cruising contacts changed at
 * least one rebuild-key input across a single poll, position at `toFixed(2)` accounting for 32.
 * Tearing the polyline primitives down that often is what blinked the line off.
 *
 * The property under test is ENTITY IDENTITY across an update, not the drawn result - a test
 * that only checked positions would pass just as happily against the clear-and-re-add version
 * that shipped the bug. Revert `upsertLeg` to clearing first and these fail.
 */
const TIME = JulianDate.now();

function fakeViewer(): Viewer {
  return {
    entities: new EntityCollection(),
    clock: { currentTime: TIME },
  } as unknown as Viewer;
}

const CONTACT = { lat: 30.6944, lon: -88.0399, altFt: 35000 };
const DEST = { destLat: LAS.lat, destLon: LAS.lon, code: "KLAS" };
const ORIG = { origLat: 33.6367, origLon: -84.4281, code: "KATL" };

/** One poll's worth of movement: about 0.02 degrees, which is what used to force a rebuild. */
const MOVED = { lat: 30.7144, lon: -88.0199, altFt: 34975 };

function textOf(e: { label?: { text?: { getValue(t: unknown): unknown } } }): unknown {
  return e.label?.text?.getValue(TIME);
}

describe("filed leg upsert reuse", () => {
  it("reuses its entities when the contact moves, rather than re-adding them", () => {
    const viewer = fakeViewer();
    const first = upsertDestination(viewer, { ...CONTACT, ...DEST });
    const second = upsertDestination(viewer, { ...MOVED, ...DEST });

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
    expect(viewer.entities.values.length).toBe(3);
  });

  it("still moves the line when it reuses the entities", () => {
    // The identity check above would also pass on a mutate branch that quietly did nothing.
    const viewer = fakeViewer();
    upsertDestination(viewer, { ...CONTACT, ...DEST });
    const [leg] = upsertDestination(viewer, { ...MOVED, ...DEST });

    const positions = leg.polyline?.positions?.getValue(TIME) as Cartesian3[];
    const start = carto(positions[0]);
    expect(start.lat).toBeCloseTo(MOVED.lat, 4);
    expect(start.lon).toBeCloseTo(MOVED.lon, 4);
    // The level run is held at the contact's NEW altitude, not the one it was created with.
    expect(start.height).toBeCloseTo(MOVED.altFt * 0.3048, 2);
  });

  it("updates the label when the filed airfield changes", () => {
    const viewer = fakeViewer();
    upsertDestination(viewer, { ...CONTACT, ...DEST });
    const [, , label] = upsertDestination(viewer, {
      ...CONTACT, destLat: 41.9786, destLon: -87.9048, code: "KORD",
    });
    expect(textOf(label)).toBe("FILED KORD");
  });

  it("draws the origin leg under its own prefix, so neither leg clears the other", () => {
    const viewer = fakeViewer();
    upsertDestination(viewer, { ...CONTACT, ...DEST });
    upsertOrigin(viewer, { ...CONTACT, ...ORIG });

    const ids = viewer.entities.values.map((e) => String(e.id));
    expect(ids.filter((i) => i.startsWith(DEST_PREFIX))).toHaveLength(3);
    expect(ids.filter((i) => i.startsWith(ORIGIN_PREFIX))).toHaveLength(3);
  });

  it("withdraws one leg without disturbing the other", () => {
    // D-062 judges each leg on its own evidence: a stale destination must not take the origin
    // down with it.
    const viewer = fakeViewer();
    upsertDestination(viewer, { ...CONTACT, ...DEST });
    const originEntities = upsertOrigin(viewer, { ...CONTACT, ...ORIG });

    clearDestination(viewer);
    expect(viewer.entities.values).toHaveLength(3);
    expect(viewer.entities.values.every((e) => String(e.id).startsWith(ORIGIN_PREFIX))).toBe(true);
    // Untouched, not rebuilt.
    expect(viewer.entities.getById(`${ORIGIN_PREFIX}leg`)).toBe(originEntities[0]);

    clearOrigin(viewer);
    expect(viewer.entities.values).toHaveLength(0);
  });

  it("labels the origin end so the two ends of one dashed line are tellable apart", () => {
    const viewer = fakeViewer();
    const [, , label] = upsertOrigin(viewer, { ...CONTACT, ...ORIG });
    expect(textOf(label)).toBe("FILED FROM KATL");
  });

  it("runs the origin leg from the contact back to the filed origin", () => {
    // Direction matters: the arc starts at the aircraft and ends at the field, the same way
    // round as the destination leg, so the plumb drop lands on the airfield.
    const viewer = fakeViewer();
    const [leg] = upsertOrigin(viewer, { ...CONTACT, ...ORIG });
    const positions = leg.polyline?.positions?.getValue(TIME) as Cartesian3[];
    const start = carto(positions[0]);
    const end = carto(positions[positions.length - 1]);
    expect(start.lat).toBeCloseTo(CONTACT.lat, 4);
    expect(end.lat).toBeCloseTo(ORIG.origLat, 4);
    expect(end.lon).toBeCloseTo(ORIG.origLon, 4);
  });

  it("rebuilds cleanly if something outside the module removed one of the three", () => {
    const viewer = fakeViewer();
    upsertDestination(viewer, { ...CONTACT, ...DEST });
    viewer.entities.remove(viewer.entities.getById(`${DEST_PREFIX}plumb`)!);

    const rebuilt = upsertDestination(viewer, { ...CONTACT, ...DEST });
    expect(rebuilt).toHaveLength(3);
    expect(viewer.entities.values).toHaveLength(3);
  });
});
