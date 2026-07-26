/**
 * Outbound reference links for the selected contact, as a plain function so it can be tested -
 * no test imports Panels.tsx, so any gating logic left inside the component is untested by
 * construction (a lesson learned the hard way: vitest goes green on a JSX syntax error there).
 *
 * The rule this exists to hold the line on: a link is rendered ONLY when the identifier it is
 * built from actually exists. A link that 404s is invented data wearing a different hat - the
 * same failure ground rule 1 forbids - so "no registration" means "no registry link", never a
 * guessed one.
 *
 * Every URL shape here was confirmed against a REAL contact (ad2862 / N947NN) before shipping.
 * Note that planespotters.net, flightradar24 and jetphotos sit behind Cloudflare bot management
 * and return 403 to every non-browser client, including for URLs that are perfectly valid - so
 * a 403 from the command line proves nothing about them either way, and the planespotters route
 * below was verified by opening it in a browser, not by fetching it.
 */
export interface ExternalLink {
  /** Chip text. Uppercased by CSS, so written here as it should read. */
  label: string;
  href: string;
  /**
   * `noreferrer` is deliberately ABSENT for planespotters and present everywhere else.
   *
   * D-009 makes attribution a licence condition, and passing the referrer is part of sending
   * them the credit their terms ask for - the shipped photo thumbnail already omits it for
   * exactly this reason. The other three are ordinary third parties with no such claim on us,
   * and once the tunnel is live the console's hostname is not theirs to collect.
   */
  rel: string;
}

/**
 * US registrations are the only ones the FAA registry holds, and `N` is exclusively a US prefix.
 * Deliberately strict rather than clever: N + a leading digit + up to four more alphanumerics.
 * A German D-AIMA or a British G-EUUU must not produce an FAA link that resolves to "no records".
 */
const US_TAIL = /^N[0-9][0-9A-Z]{0,4}$/;

export function externalLinks(
  hex: string | null,
  registration: string | null,
): ExternalLink[] {
  const links: ExternalLink[] = [];
  const h = hex?.trim() ?? "";
  const reg = registration?.trim().toUpperCase() ?? "";

  if (h) {
    // Both globes take the ICAO24 lower-case, which is the form they were verified with.
    links.push({
      label: "airplanes.live",
      href: `https://globe.airplanes.live/?icao=${encodeURIComponent(h.toLowerCase())}`,
      rel: "noopener noreferrer",
    });
    links.push({
      label: "ADSBX",
      href: `https://globe.adsbexchange.com/?icao=${encodeURIComponent(h.toLowerCase())}`,
      rel: "noopener noreferrer",
    });
    // Keyed on hex, not registration, so it is available for every contact - which is the whole
    // point in the single-file build, where the backend and therefore the photo cannot exist and
    // this link is the honest substitute for the picture that will never load.
    links.push({
      label: "planespotters",
      href: `https://www.planespotters.net/hex/${encodeURIComponent(h.toUpperCase())}`,
      rel: "noopener",
    });
  }

  // The registry's own parameter drops the N: N947NN is looked up as `947NN`.
  if (US_TAIL.test(reg)) {
    links.push({
      label: "FAA registry",
      href:
        "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=" +
        encodeURIComponent(reg.slice(1)),
      rel: "noopener noreferrer",
    });
  }

  return links;
}
