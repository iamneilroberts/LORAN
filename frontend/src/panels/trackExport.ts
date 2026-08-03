/*
 * GeoJSON export for a track.
 *
 * D-016's honesty constraint applies to the FILE, not just the screen. A GeoJSON that says
 * only "here is a LineString" invites the reader to assume it is the whole flight. So the
 * properties carry the coverage the buffer actually had: the first and last fix, the span,
 * how far back the buffer could have reached, and whether older points were already discarded.
 *
 * Coordinates are [lon, lat, altitude_metres] per RFC 7946 - which specifies WGS84 metres for
 * the third element, so feet are converted here rather than exported raw.
 */
import { FT_TO_M, type TrackResult, type VesselTrackResult } from "../state/store";

/** RFC 7946 wants an ISO 8601 string; the buffer stores UTC epoch seconds. */
function iso(ts: number | null): string | null {
  return ts === null ? null : new Date(ts * 1000).toISOString();
}

export function trackToGeoJSON(track: TrackResult, label: string) {
  const coordinates = track.points.map((p) => [
    p.lon,
    p.lat,
    p.alt_ft === null ? 0 : p.alt_ft * FT_TO_M,
  ]);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          hex: track.hex,
          label,
          point_count: track.count,
          // The coverage this file actually represents.
          first_fix: iso(track.first_ts),
          last_fix: iso(track.last_ts),
          span_seconds: track.span_s,
          sample_interval_seconds: track.sample_s,
          // Stated plainly so nobody reads first_fix as "when the flight began".
          buffer_window_seconds: track.buffer_window_s,
          older_points_discarded: track.truncated,
          coverage_note: track.truncated
            ? "Older fixes existed and were discarded: this is the tail of a longer track, " +
              "bounded by an in-memory buffer. first_fix is NOT the start of the flight."
            : "Covers every fix held for this contact. The buffer is in-memory and starts " +
              "when the contact came into range, so first_fix is not necessarily the start " +
              "of the flight.",
          exported_at: new Date().toISOString(),
          source: "loran in-memory track buffer (not a durable archive)",
        },
      },
    ],
  };
}

/**
 * Vessel variant (D-078). Same honesty properties; the third coordinate is 0 because a
 * surface vessel's altitude IS sea level, not because the value is missing.
 */
export function vesselTrackToGeoJSON(track: VesselTrackResult, label: string) {
  const coordinates = track.points.map((p) => [p.lon, p.lat, 0]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          vessel_key: track.key,
          label,
          point_count: track.count,
          first_fix: iso(track.first_ts),
          last_fix: iso(track.last_ts),
          span_seconds: track.span_s,
          sample_interval_seconds: track.sample_s,
          buffer_window_seconds: track.buffer_window_s,
          older_points_discarded: track.truncated,
          coverage_note: track.truncated
            ? "Older fixes existed and were discarded: this is the tail of a longer track, " +
              "bounded by an in-memory buffer. first_fix is NOT the start of the voyage."
            : "Covers every fix held for this vessel. The buffer is in-memory and starts " +
              "when the vessel came into range, so first_fix is not necessarily the start " +
              "of the voyage.",
          exported_at: new Date().toISOString(),
          source: "loran in-memory vessel track buffer (not a durable archive)",
        },
      },
    ],
  };
}

/** Trigger a browser download. Nothing leaves the machine. */
export function downloadGeoJSON(track: TrackResult, label: string) {
  const blob = new Blob([JSON.stringify(trackToGeoJSON(track, label), null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `track-${label || track.hex}-${track.last_ts ?? "unknown"}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadVesselGeoJSON(track: VesselTrackResult, label: string) {
  const blob = new Blob([JSON.stringify(vesselTrackToGeoJSON(track, label), null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vessel-track-${label || track.key}-${track.last_ts ?? "unknown"}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}
