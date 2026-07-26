/*
 * Basemap G: the real GEBCO_2024 depth grid, remapped to a dark console ramp.
 *
 * GEBCO ships light cartography - pale green-cyan shelf, saturated blue abyss, green land.
 * Rather than crushing it with a CSS/Cesium brightness filter (which flattens the depth signal
 * along with everything else), we remap the REAL signal per pixel. Every output pixel derives
 * from the GEBCO pixel underneath it; no depth is invented.
 *
 * Discriminators measured from the actual raster - see scripts/make_dark_bathy.py, which is the
 * same algorithm. Two traps, both hit and fixed during the mockup pass:
 *
 *   1. GEBCO_2024_Grid is a GROUP layer whose default render composites the TID (Type
 *      IDentifier) sublayer on top. That draws survey-track provenance, not depth. The
 *      renderable shaded-relief layer is GEBCO_2024.
 *   2. Land cannot be separated by "green dominant": GEBCO draws the shallow shelf as pale
 *      green-cyan (179,231,217), which classifies the whole continental shelf as land.
 *      g - b > 28 works. And luminance is NOT a usable depth proxy (pale shelf and mid-tone
 *      deep water overlap); b - r is monotonic with depth, 38 on the shelf to 133 in the abyss.
 */
import {
  Credit,
  Event as CesiumEvent,
  Rectangle,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type ImageryTypes,
  type Proxy as CesiumProxy,
  type TileDiscardPolicy,
} from "cesium";

import { palette } from "../styles/palette";

const WMS = "https://wms.gebco.net/2024/mapserv";
const LAYER = "GEBCO_2024";
const TILE = 256;

/* dark ramp, shoal -> abyss (matches scripts/make_dark_bathy.py) */
const SHOAL: RGB = [26, 76, 90];
const MID: RGB = [9, 36, 56];
const ABYSS: RGB = [4, 9, 18];
const LAND_LO: RGB = [8, 10, 13];
const LAND_HI: RGB = [30, 36, 42];

const DEPTH_SPAN = 150; // b-r range from shoal to abyss
const LAND_GB = 28;     // g-b above this is land

type RGB = [number, number, number];

/** An empty tile. Used when GEBCO cannot be reached - we draw nothing, never a guess. */
function blankTile(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = palette().bg;
    ctx.fillRect(0, 0, TILE, TILE);
  }
  return c;
}

const lerp = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/* 256-step lookups so the per-pixel loop is a table read, not arithmetic */
const WATER_LUT: RGB[] = Array.from({ length: 256 }, (_, i) =>
  i < 128 ? lerp(SHOAL, MID, i / 127.5) : lerp(MID, ABYSS, (i - 128) / 127.5),
);
const LAND_LUT: RGB[] = Array.from({ length: 256 }, (_, i) =>
  lerp(LAND_LO, LAND_HI, i / 255),
);

export class DarkBathymetryProvider implements ImageryProvider {
  readonly tileWidth = TILE;
  readonly tileHeight = TILE;
  readonly maximumLevel = 9;   // GEBCO's grid is ~450 m; past this it is just interpolation
  readonly minimumLevel = 0;
  readonly tilingScheme = new WebMercatorTilingScheme();
  readonly rectangle: Rectangle = this.tilingScheme.rectangle;
  readonly tileDiscardPolicy = undefined as unknown as TileDiscardPolicy;
  readonly errorEvent = new CesiumEvent();
  readonly credit = new Credit("GEBCO Compilation Group", false);
  readonly hasAlphaChannel = false;
  readonly proxy = undefined as unknown as CesiumProxy;
  readonly defaultAlpha = undefined;
  readonly defaultNightAlpha = undefined;
  readonly defaultDayAlpha = undefined;
  readonly defaultBrightness = undefined;
  readonly defaultContrast = undefined;
  readonly defaultHue = undefined;
  readonly defaultSaturation = undefined;
  readonly defaultGamma = undefined;
  readonly defaultMinificationFilter = undefined;
  readonly defaultMagnificationFilter = undefined;
  /** Kept for older Cesium call sites; 1.143 no longer gates on it. */
  readonly ready = true;
  readonly readyPromise = Promise.resolve(true);

  getTileCredits() {
    return [];
  }

  async requestImage(x: number, y: number, level: number): Promise<ImageryTypes> {
    const r = this.tilingScheme.tileXYToNativeRectangle(x, y, level);
    // WMS 1.1.1 + SRS=EPSG:3857 is unambiguously minx,miny,maxx,maxy. 1.3.0 axis order
    // depends on the CRS definition, which is a needless way to get a transposed map.
    const url =
      `${WMS}?request=GetMap&service=WMS&version=1.1.1&layers=${LAYER}` +
      `&srs=EPSG:3857&bbox=${r.west},${r.south},${r.east},${r.north}` +
      `&width=${TILE}&height=${TILE}&format=image/png&transparent=false&styles=`;

    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return blankTile();
      const bmp = await createImageBitmap(await res.blob());

      const canvas = document.createElement("canvas");
      canvas.width = TILE;
      canvas.height = TILE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return blankTile();
      ctx.drawImage(bmp, 0, 0, TILE, TILE);
      bmp.close();

      const img = ctx.getImageData(0, 0, TILE, TILE);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
        let out: RGB;
        if (g0 - b0 > LAND_GB) {
          const lum = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
          out = LAND_LUT[Math.max(0, Math.min(255, Math.round(((lum - 0.55) / 0.4) * 255)))];
        } else {
          const t = Math.max(0, Math.min(1, (b0 - r0) / DEPTH_SPAN));
          out = WATER_LUT[Math.round(t * 255)];
        }
        d[i] = out[0];
        d[i + 1] = out[1];
        d[i + 2] = out[2];
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return canvas;
    } catch {
      // A tile that fails to load is left blank rather than substituted with something
      // plausible. An honest gap beats a fake seabed.
      return blankTile();
    }
  }

  pickFeatures(): undefined {
    return undefined;
  }
}
