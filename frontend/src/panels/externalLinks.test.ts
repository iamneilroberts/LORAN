/**
 * The property that matters here: a link is built only from an identifier we actually have.
 * The easy fake pass would be a test that only ever feeds in a complete contact and checks the
 * URLs come out right - it would stay green if the gating were deleted entirely. So the missing
 * and foreign-registration cases carry the weight, and the URL-shape tests exist to pin the
 * exact forms that were verified against the live contact ad2862 / N947NN.
 */
import { describe, expect, it } from "vitest";

import { externalLinks } from "./externalLinks";

const find = (hex: string | null, reg: string | null, label: string) =>
  externalLinks(hex, reg).find((l) => l.label === label);

describe("externalLinks", () => {
  it("builds the three hex-keyed links in the exact verified forms", () => {
    const links = externalLinks("ad2862", "N947NN");
    expect(find("ad2862", "N947NN", "airplanes.live")?.href)
      .toBe("https://globe.airplanes.live/?icao=ad2862");
    expect(find("ad2862", "N947NN", "ADSBX")?.href)
      .toBe("https://globe.adsbexchange.com/?icao=ad2862");
    // Uppercase hex - the form the browser check was done with.
    expect(find("ad2862", "N947NN", "planespotters")?.href)
      .toBe("https://www.planespotters.net/hex/AD2862");
    expect(links).toHaveLength(4);
  });

  it("normalises hex case so an upper-case feed value still yields the verified URLs", () => {
    expect(find("AD2862", null, "airplanes.live")?.href)
      .toBe("https://globe.airplanes.live/?icao=ad2862");
    expect(find("AD2862", null, "planespotters")?.href)
      .toBe("https://www.planespotters.net/hex/AD2862");
  });

  it("drops the N from the FAA registry parameter", () => {
    // The registry looks N947NN up as `947NN`; sending the N returns nothing useful.
    expect(find("ad2862", "N947NN", "FAA registry")?.href)
      .toBe("https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=947NN");
  });

  it("renders NO links at all when the hex is missing or blank", () => {
    // Without this the gating could be deleted and the suite would still pass.
    expect(externalLinks(null, null)).toEqual([]);
    expect(externalLinks("", null)).toEqual([]);
    expect(externalLinks("   ", null)).toEqual([]);
  });

  it("omits the FAA link when there is no registration", () => {
    const labels = externalLinks("ad2862", null).map((l) => l.label);
    expect(labels).not.toContain("FAA registry");
    expect(labels).toHaveLength(3);
  });

  it("omits the FAA link for non-US registrations", () => {
    // The FAA holds US airframes only. A link that resolves to "no records found" claims we
    // looked something up when we did not.
    for (const foreign of ["G-EUUU", "D-AIMA", "F-GKXA", "JA8089", "VH-OQA", "C-FGDT"]) {
      expect(externalLinks("ad2862", foreign).map((l) => l.label)).not.toContain("FAA registry");
    }
  });

  it("still builds the FAA link for short and letter-suffixed US tails", () => {
    expect(find("ad2862", "N1", "FAA registry")?.href).toContain("nNumberTxt=1");
    expect(find("aba835", "N850JW", "FAA registry")?.href).toContain("nNumberTxt=850JW");
    // Lower case off the feed must not defeat the match.
    expect(find("aba835", "n850jw", "FAA registry")?.href).toContain("nNumberTxt=850JW");
  });

  it("keeps the referrer for planespotters and strips it everywhere else", () => {
    // D-009: attribution is a licence condition, and the referrer is part of the credit.
    // This is a deliberate asymmetry, so it gets a test that fails if someone 'tidies' it.
    expect(find("ad2862", "N947NN", "planespotters")?.rel).toBe("noopener");
    for (const label of ["airplanes.live", "ADSBX", "FAA registry"]) {
      expect(find("ad2862", "N947NN", label)?.rel).toBe("noopener noreferrer");
    }
  });
});
