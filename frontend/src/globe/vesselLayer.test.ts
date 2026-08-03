/**
 * effectiveFix: which position/course is actually drawn for a vessel (D-078).
 *
 * The rule under test is an honesty rule: the newer real measurement wins, sources are never
 * blended into a state neither of them reported, and a failed detail lookup changes nothing.
 */
import { describe, expect, it } from "vitest";

import { effectiveFix } from "./vesselLayer";
import type { Vessel, VesselDetail } from "../state/store";

function vessel(over: Partial<Vessel> = {}): Vessel {
  return {
    key: "255806173", mmsi: "255806173", ship_id: "371555", name: "MSC ANTONIA",
    callsign: null, imo: null, lat: 30.5, lon: -88.1, speed_kt: 12.4,
    course_deg: null, course_source: null, type: "Cargo", category: "cargo",
    country: null, destination: null, port_current: null, port_next: null,
    area: null, pos_ts: 1_785_712_000, military: false,
    ...over,
  };
}

function detail(over: Partial<VesselDetail> = {}): VesselDetail {
  return {
    mmsi: "255806173", lat: 30.51, lon: -88.09, course_deg: 145,
    course_source: "reported", speed_kt: 12.0, pos_ts: 1_785_712_600, errors: [],
    ...over,
  };
}

describe("effectiveFix", () => {
  it("uses the snapshot alone when nothing is selected", () => {
    const fix = effectiveFix(vessel(), detail(), false);
    expect(fix.lat).toBe(30.5);
    expect(fix.courseDeg).toBeNull();
  });

  it("a NEWER detail fix replaces the snapshot position and supplies the course", () => {
    const fix = effectiveFix(vessel(), detail(), true);
    expect(fix.lat).toBe(30.51);
    expect(fix.lon).toBe(-88.09);
    expect(fix.courseDeg).toBe(145);
    expect(fix.posTs).toBe(1_785_712_600);
  });

  it("an OLDER detail fix does not drag the vessel backwards, but its course still fills a gap", () => {
    const fix = effectiveFix(
      vessel({ pos_ts: 1_785_713_000 }),
      detail({ pos_ts: 1_785_712_600 }),
      true,
    );
    expect(fix.lat).toBe(30.5);
    expect(fix.posTs).toBe(1_785_713_000);
    // The snapshot had no course at all; the reported one is the best course held.
    expect(fix.courseDeg).toBe(145);
  });

  it("a failed detail lookup changes nothing", () => {
    const fix = effectiveFix(vessel(), detail({ errors: ["boom"] }), true);
    expect(fix.lat).toBe(30.5);
    expect(fix.courseDeg).toBeNull();
  });

  it("a detail reply for a DIFFERENT vessel is ignored", () => {
    const fix = effectiveFix(vessel(), detail({ mmsi: "999999999" }), true);
    expect(fix.lat).toBe(30.5);
    expect(fix.courseDeg).toBeNull();
  });

  it("a position-less detail reply keeps the snapshot position", () => {
    const fix = effectiveFix(vessel(), detail({ lat: null, lon: null }), true);
    expect(fix.lat).toBe(30.5);
    expect(fix.courseDeg).toBe(145);
  });
});
