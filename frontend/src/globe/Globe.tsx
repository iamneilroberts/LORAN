/*
 * The globe. Cesium viewer, keyless, in a tilted 3D perspective - the whole point of the
 * project is judging relative position in space, which a top-down map cannot show.
 */
import { useEffect, useRef } from "react";
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  Ion,
  Math as CMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { DarkBathymetryProvider } from "./DarkBathymetryProvider";
import { addPlane, AMBER, clearByPrefix, CYAN } from "./altitudePlanes";
import { createAircraftLayer } from "./aircraftLayer";
import { distanceNm, FT_TO_M, useStore, type Aircraft } from "../state/store";

const BAND_PREFIX = "band::";
const DATUM_PREFIX = "datum::";
const TRACK_PREFIX = "track::";

export default function Globe() {
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    // Keyless: must be set before the Viewer is constructed. docs/decisions.md D-003
    Ion.defaultAccessToken = null as unknown as string;

    const viewer = new Viewer(ref.current, {
      terrainProvider: new EllipsoidTerrainProvider(),
      baseLayer: false as never,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      contextOptions: { webgl: { alpha: false } },
    });
    viewerRef.current = viewer;
    // Exposed deliberately: this is a single-user homelab console and being able to poke the
    // scene from devtools is worth more than hiding it.
    (window as unknown as { __viewer: Viewer }).__viewer = viewer;

    const { scene, camera } = viewer;
    scene.globe.baseColor = Color.fromCssColorString("#05070a");
    scene.backgroundColor = Color.fromCssColorString("#05070a");
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.enableLighting = false;
    scene.fog.enabled = false;
    // Aircraft and planes sit above the ellipsoid; terrain depth-testing clips them.
    scene.globe.depthTestAgainstTerrain = false;

    scene.imageryLayers.addImageryProvider(new DarkBathymetryProvider());

    const layer = createAircraftLayer(scene);
    const s0 = useStore.getState();

    /* --- open in perspective, not plan view --- */
    camera.setView({
      destination: Cartesian3.fromDegrees(s0.home.lon, s0.home.lat - 1.9, 145_000),
      orientation: {
        heading: CMath.toRadians(0),
        pitch: CMath.toRadians(-32),   // tilted: altitude is visible as height, not as nothing
        roll: 0,
      },
    });

    /* --- cursor lat/lon, and a debounced real depth lookup --- */
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    let depthTimer: number | undefined;

    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      const ray = camera.getPickRay(m.endPosition);
      const carto = ray ? scene.globe.pick(ray, scene) : undefined;
      if (!carto) {
        useStore.getState().setCursor(null);
        return;
      }
      const c = scene.globe.ellipsoid.cartesianToCartographic(carto);
      const lat = CMath.toDegrees(c.latitude);
      const lon = CMath.toDegrees(c.longitude);
      useStore.getState().setCursor({ lat, lon });

      window.clearTimeout(depthTimer);
      useStore.getState().setDepth(useStore.getState().depthM, true);
      depthTimer = window.setTimeout(async () => {
        try {
          const r = await fetch(`/api/depth?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
          if (!r.ok) throw new Error(String(r.status));
          const d = await r.json();
          useStore.getState().setDepth(d.elevation_m ?? null, false);
        } catch {
          // No value is better than a plausible one.
          useStore.getState().setDepth(null, false);
        }
      }, 260);
    }, ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((m: { position: Cartesian2 }) => {
      useStore.getState().select(layer.pick(scene, m.position));
    }, ScreenSpaceEventType.LEFT_CLICK);

    /* --- per-frame: dead reckoning, planes, FPS --- */
    let frames = 0;
    let fpsMark = performance.now();

    const onTick = () => {
      const st = useStore.getState();
      const elapsedS = st.lastFetchWall ? (Date.now() - st.lastFetchWall) / 1000 : 0;

      const sel: Aircraft | undefined = st.selectedHex
        ? st.aircraft.find((a) => a.hex === st.selectedHex)
        : undefined;
      const datumAltFt = st.showDatum && sel?.alt_ft != null ? sel.alt_ft : null;

      layer.update(st.aircraft, elapsedS, {
        selectedHex: st.selectedHex,
        showDropLines: st.showDropLines,
        separationFt: st.separationFt,
        datumAltFt,
        dropToAltFt: (a) => {
          // Drop to the datum when one is active and the contact is inside its radius,
          // otherwise to the nearest band floor below. Never to the ground: a 35,000 ft
          // streak to sea level is noise, not information.
          if (sel && datumAltFt !== null) {
            const d = distanceNm(a.lat, a.lon, sel.lat, sel.lon);
            if (d <= st.datumRadiusNm) return datumAltFt;
          }
          if (!st.showBands) return null;
          const alt = a.alt_ft ?? 0;
          const below = st.bands.filter((b) => b.floorFt <= alt).map((b) => b.floorFt);
          return below.length ? Math.max(...below) : null;
        },
      });

      frames++;
      const now = performance.now();
      if (now - fpsMark >= 1000) {
        useStore.getState().setFps(Math.round((frames * 1000) / (now - fpsMark)));
        frames = 0;
        fpsMark = now;
      }
    };
    scene.postRender.addEventListener(onTick);

    /* --- track path: drawn at the TRUE altitude of each fix, not flattened to the ground.
     *     Rebuilt only when the loaded track changes, which is a user action, not a poll. --- */
    let lastTrackKey = "";
    const unsubTrack = useStore.subscribe((st) => {
      const t = st.track;
      const key = t ? `${t.hex}|${t.count}|${t.last_ts ?? ""}` : "";
      if (key === lastTrackKey) return;
      lastTrackKey = key;

      clearByPrefix(viewer, TRACK_PREFIX);
      if (!t || t.points.length < 2) return;

      viewer.entities.add({
        id: `${TRACK_PREFIX}${t.hex}`,
        polyline: {
          positions: t.points.map((p) =>
            Cartesian3.fromDegrees(p.lon, p.lat, (p.alt_ft ?? 0) * FT_TO_M),
          ),
          width: 1.6,
          material: Color.fromCssColorString("#5fd7e0").withAlpha(0.75),
          // The track is a measurement, not scenery: it must stay visible where it passes
          // behind terrain rather than being silently clipped into a shorter path.
          arcType: ArcType.GEODESIC,
        },
      });
    });

    /* --- planes rebuild only when their inputs change --- */
    let lastKey = "";
    const unsub = useStore.subscribe((st) => {
      const sel = st.selectedHex ? st.aircraft.find((a) => a.hex === st.selectedHex) : undefined;
      const key = [
        st.showBands,
        st.showDatum,
        st.datumRadiusNm,
        st.home.lat.toFixed(3),
        st.home.lon.toFixed(3),
        st.bands.map((b) => `${b.floorFt}-${b.ceilFt}`).join(","),
        sel?.hex ?? "",
        sel?.alt_ft ?? "",
        sel ? `${sel.lat.toFixed(2)},${sel.lon.toFixed(2)}` : "",
      ].join("|");
      if (key === lastKey) return;
      lastKey = key;

      clearByPrefix(viewer, BAND_PREFIX);
      clearByPrefix(viewer, DATUM_PREFIX);

      if (st.showBands) {
        st.bands.forEach((b, i) =>
          addPlane(viewer, {
            id: `${BAND_PREFIX}${i}`,
            lat: st.home.lat,
            lon: st.home.lon,
            radiusNm: 95,
            altFt: b.ceilFt,
            colour: i === 0 ? CYAN : AMBER,
            label: b.label,
          }),
        );
      }
      if (st.showDatum && sel?.alt_ft != null) {
        addPlane(viewer, {
          id: `${DATUM_PREFIX}0`,
          lat: sel.lat,
          lon: sel.lon,
          radiusNm: st.datumRadiusNm,
          altFt: sel.alt_ft,
          colour: AMBER,
          label: `DATUM ${Math.round(sel.alt_ft).toLocaleString()} FT · ±${st.datumRadiusNm} NM`,
          emphasis: true,
          // Solid, not grid: a dense wireframe at a shallow viewing angle moires into
          // noise and stops reading as a surface, which is its only job.
          fill: "solid",
        });
      }
    });

    return () => {
      window.clearTimeout(depthTimer);
      unsub();
      unsubTrack();
      scene.postRender.removeEventListener(onTick);
      handler.destroy();
      layer.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  return <div ref={ref} className="absolute inset-0" />;
}
