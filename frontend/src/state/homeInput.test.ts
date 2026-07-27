/**
 * The easy fake pass here is testing only well-formed input — every parser handles "30.6944".
 * So the weight is on the inputs that would put the console somewhere wrong without saying so:
 * empty strings (which `Number("")` turns into 0, i.e. the Gulf of Guinea), partial numbers, and
 * out-of-range values. Plus the labelling rule, because a coordinate we did not look up must
 * never acquire a place name.
 */
import { describe, expect, it } from "vitest";

import {
  coordLabel, effectiveHome, geocodedLabel, isHomePos, parseCoord, problemText, validateHome,
} from "./homeInput";

const MOBILE = { lat: 30.6944, lon: -88.0399, label: "MOBILE, AL" };

describe("parseCoord", () => {
  it("parses the forms a person actually types", () => {
    expect(parseCoord("30.6944")).toBeCloseTo(30.6944, 6);
    expect(parseCoord("-88.0399")).toBeCloseTo(-88.0399, 6);
    expect(parseCoord("  47  ")).toBe(47);
    expect(parseCoord("+12.5")).toBe(12.5);
    expect(parseCoord(".5")).toBe(0.5);
    expect(parseCoord("0")).toBe(0);
  });

  it("returns null rather than 0 for an empty field", () => {
    // Number("") is 0. Coercing here would silently move the console to 0,0 - in the Gulf of
    // Guinea - and the display would look perfectly healthy while showing the wrong ocean.
    expect(parseCoord("")).toBeNull();
    expect(parseCoord("   ")).toBeNull();
  });

  it("rejects partially-numeric junk instead of half-accepting it", () => {
    for (const bad of ["12abc", "1,2", "30.69.44", "N30.69", "--5", "1e5", "Infinity", "NaN"]) {
      expect(parseCoord(bad)).toBeNull();
    }
  });
});

describe("validateHome", () => {
  it("accepts a real position", () => {
    expect(validateHome(30.6944, -88.0399)).toBeNull();
  });

  it("accepts the exact edges of the coordinate system", () => {
    expect(validateHome(90, 180)).toBeNull();
    expect(validateHome(-90, -180)).toBeNull();
  });

  it("rejects out-of-range values in each direction", () => {
    expect(validateHome(90.1, 0)).toBe("lat-range");
    expect(validateHome(-90.1, 0)).toBe("lat-range");
    expect(validateHome(0, 180.1)).toBe("lon-range");
    expect(validateHome(0, -180.1)).toBe("lon-range");
  });

  it("names the missing field specifically", () => {
    expect(validateHome(null, 0)).toBe("lat-missing");
    expect(validateHome(0, null)).toBe("lon-missing");
  });

  it("gives every problem a message, so none can render blank", () => {
    for (const p of ["lat-missing", "lon-missing", "lat-range", "lon-range"] as const) {
      expect(problemText(p)).toBeTruthy();
    }
    expect(problemText(null)).toBeNull();
  });
});

describe("coordLabel", () => {
  it("labels a position by its coordinates and never by a place name", () => {
    // The whole point: no geocoder exists, so nothing here may claim to know where this is.
    expect(coordLabel(30.6944, -88.0399)).toBe("30.69N 88.04W");
    expect(coordLabel(-33.87, 151.21)).toBe("33.87S 151.21E");
  });

  it("puts the equator north and the prime meridian east, rather than showing a sign", () => {
    expect(coordLabel(0, 0)).toBe("0.00N 0.00E");
  });
});

describe("effectiveHome", () => {
  it("uses the server's home when there is no override", () => {
    // A browser that never touches the control must behave exactly as before this shipped.
    expect(effectiveHome(MOBILE, null)).toEqual(MOBILE);
  });

  it("lets an override win", () => {
    const o = { lat: 47.6062, lon: -122.3321, label: "47.61N 122.33W" };
    expect(effectiveHome(MOBILE, o)).toEqual(o);
  });

  it("keeps the server home intact so a reset is possible", () => {
    const o = { lat: 1, lon: 2, label: "1.00N 2.00E" };
    effectiveHome(MOBILE, o);
    expect(effectiveHome(MOBILE, null)).toEqual(MOBILE);
  });
});

describe("isHomePos", () => {
  it("accepts a well-formed position", () => {
    expect(isHomePos(MOBILE)).toBe(true);
  });

  it("rejects anything a corrupt localStorage could hold", () => {
    // This is the guard between persisted JSON and the camera. Nothing else validates it.
    for (const bad of [
      null, undefined, 42, "MOBILE", {},
      { lat: 30, lon: -88 },                          // no label
      { lat: "30", lon: -88, label: "x" },            // lat is a string
      { lat: 91, lon: 0, label: "x" },                // out of range
      { lat: 0, lon: -181, label: "x" },              // out of range
      { lat: NaN, lon: 0, label: "x" },
      { lat: Infinity, lon: 0, label: "x" },
    ]) {
      expect(isHomePos(bad)).toBe(false);
    }
  });
});

/**
 * The geocoded-label rule (D-069) — the one place the D-068 "never name an un-looked-up
 * coordinate" rule bends, and the tests are about keeping the bend narrow. The easy fake pass is
 * checking that a name comes back when a name is given; what matters is that an ABSENT name does
 * not get manufactured, and that a present one is not touched up on the way through.
 */
describe("geocodedLabel", () => {
  it("uses the geocoder's name verbatim", () => {
    expect(geocodedLabel("Springfield", 39.799, -89.644)).toBe("Springfield");
    expect(geocodedLabel("Mobile Regional Airport", 30.693, -88.241))
      .toBe("Mobile Regional Airport");
  });

  it("does not prettify, shorten or re-case the name", () => {
    // Whatever the geocoder said is what the status bar prints as fact.
    expect(geocodedLabel("saint-étienne-du-rouvray", 49.38, 1.10))
      .toBe("saint-étienne-du-rouvray");
    expect(geocodedLabel("Kingston upon Hull, City of Kingston upon Hull", 53.74, -0.33))
      .toBe("Kingston upon Hull, City of Kingston upon Hull");
  });

  it("falls back to coordinates when the place has no name of its own", () => {
    // A street address returns name "". Naming it from its address fragments would be
    // inventing a place name out of real parts, which is still inventing it.
    expect(geocodedLabel("", 30.6901, -88.0412)).toBe(coordLabel(30.6901, -88.0412));
    expect(geocodedLabel("   ", 30.6901, -88.0412)).toBe(coordLabel(30.6901, -88.0412));
    expect(geocodedLabel("", 30.6901, -88.0412)).toBe("30.69N 88.04W");
  });
});
