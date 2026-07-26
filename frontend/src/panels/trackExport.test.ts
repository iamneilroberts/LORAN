/**
 * D-016's honesty constraint applies to the FILE, not just the screen. A GeoJSON carrying only a
 * LineString invites the reader to assume it is the whole flight, so the properties have to state
 * the coverage the buffer actually had - including, loudly, when older fixes were discarded.
 *
 * These tests guard that contract. The geometry is the easy part; the properties are the promise.
 */
import { describe, expect, it } from "vitest";

import { trackToGeoJSON } from "./trackExport";
import type { TrackResult } from "../state/store";

const FT_TO_M = 0.3048;

function track(over: Partial<TrackResult> = {}): TrackResult {
  return {
    hex: "a39dca",
    count: 3,
    first_ts: 1785034573,
    last_ts: 1785035344,
    span_s: 771,
    buffer_window_s: 1800,
    sample_s: 5,
    truncated: false,
    points: [
      { ts: 1785034573, lat: 31.789307, lon: -89.994507, alt_ft: 30900 },
      { ts: 1785034900, lat: 31.2, lon: -90.1, alt_ft: 20000 },
      { ts: 1785035344, lat: 30.398285, lon: -90.206268, alt_ft: null },
    ],
    ...over,
  };
}

describe("trackToGeoJSON", () => {
  it("emits a single LineString Feature in a FeatureCollection", () => {
    const g = trackToGeoJSON(track(), "FFT1257");
    expect(g.type).toBe("FeatureCollection");
    expect(g.features).toHaveLength(1);
    expect(g.features[0].geometry.type).toBe("LineString");
  });

  it("writes coordinates as [lon, lat, metres] per RFC 7946, not [lat, lon, feet]", () => {
    // Getting this backwards is the classic GeoJSON bug and it renders as a track in the
    // wrong hemisphere, so it is worth an explicit assertion.
    const g = trackToGeoJSON(track(), "FFT1257");
    const [lon, lat, alt] = g.features[0].geometry.coordinates[0];
    expect(lon).toBeCloseTo(-89.994507, 6);
    expect(lat).toBeCloseTo(31.789307, 6);
    expect(alt).toBeCloseTo(30900 * FT_TO_M, 3);
  });

  it("writes an unknown altitude as 0 metres rather than dropping the fix", () => {
    // The position is still real even when the altitude is not; discarding the point would
    // silently shorten the track.
    const g = trackToGeoJSON(track(), "FFT1257");
    const coords = g.features[0].geometry.coordinates;
    expect(coords).toHaveLength(3);
    expect(coords[2][2]).toBe(0);
  });

  it("states the coverage the buffer actually had", () => {
    const p = trackToGeoJSON(track(), "FFT1257").features[0].properties;
    expect(p.hex).toBe("a39dca");
    expect(p.label).toBe("FFT1257");
    expect(p.point_count).toBe(3);
    expect(p.span_seconds).toBe(771);
    expect(p.sample_interval_seconds).toBe(5);
    expect(p.buffer_window_seconds).toBe(1800);
  });

  it("converts epoch seconds to ISO 8601, not milliseconds", () => {
    const p = trackToGeoJSON(track(), "X").features[0].properties;
    expect(p.first_fix).toBe(new Date(1785034573 * 1000).toISOString());
    expect(p.last_fix).toBe(new Date(1785035344 * 1000).toISOString());
  });

  it("carries a null timestamp through as null rather than epoch zero", () => {
    const p = trackToGeoJSON(track({ first_ts: null, last_ts: null }), "X")
      .features[0].properties;
    expect(p.first_fix).toBeNull();
    expect(p.last_fix).toBeNull();
  });

  it("says out loud when older fixes were discarded", () => {
    // The whole point of D-016: first_fix must never be read as "when the flight began".
    const p = trackToGeoJSON(track({ truncated: true }), "X").features[0].properties;
    expect(p.older_points_discarded).toBe(true);
    expect(p.coverage_note).toMatch(/NOT the start of the flight/);
  });

  it("still warns that first_fix is not the start of the flight when nothing was discarded", () => {
    const p = trackToGeoJSON(track({ truncated: false }), "X").features[0].properties;
    expect(p.older_points_discarded).toBe(false);
    expect(p.coverage_note).toMatch(/came into range/);
  });

  it("handles an empty track without inventing geometry", () => {
    const g = trackToGeoJSON(track({ points: [], count: 0, span_s: 0 }), "X");
    expect(g.features[0].geometry.coordinates).toEqual([]);
    expect(g.features[0].properties.point_count).toBe(0);
  });
});
