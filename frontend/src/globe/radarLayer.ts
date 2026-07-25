/*
 * Weather radar: NEXRAD base reflectivity (D-040).
 *
 * This REVERSES CLAUDE.md's "no weather" non-goal, on the owner's explicit instruction, and it
 * is OFF BY DEFAULT for a specific reason: reflectivity ramps green -> yellow -> orange -> red,
 * and the altitude hue ramp (D-029) already spends green at 20,000 ft, yellow-green at 30,000
 * and pale yellow at 45,000. Both encodings on screen at once make colour ambiguous, so radar
 * is something you turn ON to answer a question, not part of the resting display.
 *
 * Base reflectivity is a GROUND-PLANE product draped on the ellipsoid. It is not the weather at
 * the selected contact's altitude and must never be read as such - the honest use is "there is
 * a cell under that deviation", not "that aircraft is in this".
 *
 * Frames are roughly five minutes old. The layer therefore REBUILDS itself every five minutes
 * while visible: a radar image silently left on screen for an hour is exactly the "plausible
 * fake" ground rule 1 forbids. Nothing refreshes while the layer is hidden.
 */
import {
  ImageryLayer,
  WebMapServiceImageryProvider,
  WebMercatorTilingScheme,
  type Scene,
} from "cesium";

import { RADAR_ALPHA, RADAR_LAYER, RADAR_MAX_LEVEL, RADAR_REFRESH_MS, RADAR_WMS } from "../config";

export interface RadarLayer {
  setShow: (on: boolean) => void;
  destroy: () => void;
}

export function createRadarLayer(scene: Scene): RadarLayer {
  let layer: ImageryLayer | null = null;
  let timer: number | undefined;

  function build(): ImageryLayer {
    const provider = new WebMapServiceImageryProvider({
      url: RADAR_WMS,
      layers: RADAR_LAYER,
      // The -900913 layers are IEM's web-mercator renders, so match the tiling scheme rather
      // than making the server reproject every tile.
      tilingScheme: new WebMercatorTilingScheme(),
      parameters: {
        format: "image/png",
        transparent: true,
        // Cache-buster keyed to the frame interval. Without it the browser and Cesium both
        // happily serve the frame from an hour ago.
        _t: String(Math.floor(Date.now() / RADAR_REFRESH_MS)),
      },
      // Radar is ~1 km data; past this level tiles are pure upscaling and imply precision
      // the source does not have.
      maximumLevel: RADAR_MAX_LEVEL,
      credit: "NEXRAD base reflectivity · NOAA/NWS via Iowa State Mesonet",
    });
    const l = new ImageryLayer(provider, { alpha: RADAR_ALPHA });
    scene.imageryLayers.add(l);
    return l;
  }

  function drop() {
    if (layer) {
      scene.imageryLayers.remove(layer, true);
      layer = null;
    }
  }

  return {
    setShow: (on: boolean) => {
      window.clearInterval(timer);
      timer = undefined;

      if (!on) {
        drop();
        return;
      }
      if (!layer) layer = build();
      timer = window.setInterval(() => {
        // Rebuild rather than mutate: the provider's request URL carries the frame bucket.
        drop();
        layer = build();
      }, RADAR_REFRESH_MS);
    },
    destroy: () => {
      window.clearInterval(timer);
      drop();
    },
  };
}
