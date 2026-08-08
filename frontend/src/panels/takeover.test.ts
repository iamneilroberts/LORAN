/**
 * The property that matters: TAKE CONTROL is offered ONLY for a contact the sim can honestly
 * spawn — airborne, a fresh position, and the altitude / ground-speed / track the physics needs.
 * The easy fake pass would feed in only a complete contact and check the URL; it would stay green
 * if every gate were deleted. So each refusal case breaks exactly one field of an otherwise
 * flyable contact and carries the weight, mirroring adsb-game's own eligibility gate.
 */
import { describe, expect, it } from "vitest";

import { canTakeControl, simTakeoverUrl, MAX_SEEN_POS_S } from "./takeover";
import type { Aircraft } from "../state/store";

/** A contact that passes every gate. Each test overrides one field to break one gate. */
function flyable(over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex: "ad2862", flight: "AAL123", registration: null, type: null, desc: null,
    operator: null, year: null, category: null, lat: 30.7, lon: -88.0,
    alt_ft: 30000, alt_geom_ft: 30000, alt_baro_ft: 30000, on_ground: false,
    gs_kt: 420, track_deg: 90, baro_rate_fpm: null, geom_rate_fpm: null,
    squawk: null, emergency: null, military: false, ladd: false, pia: false,
    seen_pos_s: 3, rssi: null, ...over,
  };
}

describe("canTakeControl", () => {
  it("accepts an airborne contact with a fresh position and full telemetry", () => {
    expect(canTakeControl(flyable())).toEqual({ eligible: true });
  });

  it("refuses when nothing is selected", () => {
    expect(canTakeControl(null)).toEqual({ eligible: false, reason: "NO CONTACT SELECTED" });
    expect(canTakeControl(undefined)).toEqual({ eligible: false, reason: "NO CONTACT SELECTED" });
  });

  it("refuses a contact with no ICAO hex — the deep-link cannot be built without one", () => {
    expect(canTakeControl(flyable({ hex: null }))).toEqual({
      eligible: false, reason: "NO ICAO HEX",
    });
  });

  it("refuses a contact on the ground (airborne spawn only)", () => {
    expect(canTakeControl(flyable({ on_ground: true }))).toEqual({
      eligible: false, reason: "ON GROUND",
    });
  });

  it("refuses a stale position, naming the age", () => {
    // seen_pos runs to ~50 s; spawning on a 40-second-old fix is a lie.
    expect(canTakeControl(flyable({ seen_pos_s: 40 }))).toEqual({
      eligible: false, reason: "POSITION STALE (40S)",
    });
  });

  it("refuses an unknown position age, naming it with an em-dash not a guess", () => {
    expect(canTakeControl(flyable({ seen_pos_s: null }))).toEqual({
      eligible: false, reason: "POSITION STALE (—S)",
    });
  });

  it("accepts a position exactly at the freshness bound (matches adsb-game's > gate)", () => {
    expect(canTakeControl(flyable({ seen_pos_s: MAX_SEEN_POS_S }))).toEqual({ eligible: true });
  });

  it("refuses only when BOTH altitude sources are missing", () => {
    // geom preferred, baro fallback — either alone is enough to spawn.
    expect(canTakeControl(flyable({ alt_geom_ft: null }))).toEqual({ eligible: true });
    expect(canTakeControl(flyable({ alt_baro_ft: null }))).toEqual({ eligible: true });
    expect(canTakeControl(flyable({ alt_geom_ft: null, alt_baro_ft: null }))).toEqual({
      eligible: false, reason: "NO ALTITUDE",
    });
  });

  it("refuses without ground speed", () => {
    expect(canTakeControl(flyable({ gs_kt: null }))).toEqual({
      eligible: false, reason: "NO GROUND SPEED",
    });
  });

  it("refuses without a track", () => {
    expect(canTakeControl(flyable({ track_deg: null }))).toEqual({
      eligible: false, reason: "NO TRACK",
    });
  });
});

describe("simTakeoverUrl", () => {
  it("builds the deep-link against the default sim base with a lowercase hex", () => {
    expect(simTakeoverUrl("ad2862")).toBe("https://adsb.voygent.app/?takeover=ad2862");
  });

  it("lowercases an upper-case feed hex", () => {
    expect(simTakeoverUrl("AD2862")).toBe("https://adsb.voygent.app/?takeover=ad2862");
  });

  it("trims surrounding whitespace off the hex", () => {
    expect(simTakeoverUrl("  ad2862 ")).toBe("https://adsb.voygent.app/?takeover=ad2862");
  });

  it("honours an explicit base so the sim can be pointed elsewhere", () => {
    expect(simTakeoverUrl("ad2862", "http://localhost:5174")).toBe(
      "http://localhost:5174/?takeover=ad2862",
    );
  });

  it("strips a trailing slash on the base so the path never doubles up", () => {
    expect(simTakeoverUrl("ad2862", "https://adsb.voygent.app/")).toBe(
      "https://adsb.voygent.app/?takeover=ad2862",
    );
  });
});
