/**
 * `levelArc` exists because Cesium arcs across the SURFACE: hand it two points and
 * ArcType.GEODESIC and a long leg sags through the terrain between samples. The line has to hold
 * the contact's altitude for its whole length, because a line that descends toward the runway
 * would draw a descent profile we have never computed (D-050).
 *
 * So the test that matters most here is the boring one: every point is at the same height.
 */
import { Cartographic, Cartesian3 } from "cesium";
import { describe, expect, it } from "vitest";

import { levelArc } from "./destinationLine";

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
