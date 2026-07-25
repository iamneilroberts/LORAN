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
import { AMBER, clearByPrefix, upsertPlane } from "./altitudePlanes";
import { createAircraftLayer } from "./aircraftLayer";
import { createPlacesLayer } from "./placesLayer";
import {
  FT_TO_M, hasSlicePerspective, matchesFilter, useStore, type Aircraft,
} from "../state/store";

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

    // Render at the display's real pixel density. Cesium defaults this to true, which pins the
    // drawing buffer to one buffer pixel per CSS pixel - so on a HiDPI screen every label and
    // icon is upscaled, which is what made the readouts look soft.
    //
    // Do NOT also raise resolutionScale. Cesium computes
    //     pixelRatio = (useBrowserRecommendedResolution ? 1 : devicePixelRatio) * resolutionScale
    // so setting resolutionScale to devicePixelRatio squares it: 4x linear / 16x the pixels on
    // a 2x display. Measured at 6400px of buffer for a 1600px canvas before this was corrected.
    viewer.useBrowserRecommendedResolution = false;
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
    // Static ground reference, built once here and thereafter only shown or hidden (D-032).
    const places = createPlacesLayer(scene);
    const s0 = useStore.getState();
    places.setShow(s0.showPlaces);

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
      // Aircraft win over airfields: the traffic is the subject and is drawn above the ground.
      // A click that hits neither still clears the selection, so click-empty-to-clear survives.
      const hex = layer.pick(scene, m.position);
      if (hex) {
        useStore.getState().select(hex);
        return;
      }
      useStore.getState().selectPlace(places.pick(scene, m.position));
    }, ScreenSpaceEventType.LEFT_CLICK);

    /* --- per-frame: dead reckoning, planes, FPS --- */
    let frames = 0;
    let fpsMark = performance.now();
    let lastPitch = CMath.toDegrees(camera.pitch);

    const onTick = () => {
      const st = useStore.getState();

      // Published only when it actually moves a degree. Writing camera pitch to the store on
      // every frame would wake every subscriber 30 times a second for nothing.
      const pitchDeg = CMath.toDegrees(camera.pitch);
      if (Math.abs(pitchDeg - lastPitch) >= 1) {
        lastPitch = pitchDeg;
        useStore.getState().setCameraPitch(pitchDeg);
      }
      const elapsedS = st.lastFetchWall ? (Date.now() - st.lastFetchWall) / 1000 : 0;

      const sel: Aircraft | undefined = st.selectedHex
        ? st.aircraft.find((a) => a.hex === st.selectedHex)
        : undefined;
      const datumAltFt = st.showDatum && sel?.alt_ft != null ? sel.alt_ft : null;

      // Filtering narrows what is DRAWN, never what is counted - the status bar keeps
      // reporting true totals. The selected contact is always drawn even if the filter
      // excludes it; hiding the thing the dossier is describing would be incoherent.
      const visible = st.aircraft.filter(
        (a) => matchesFilter(a, st.filter) || a.hex === st.selectedHex,
      );

      layer.update(visible, elapsedS, {
        selectedHex: st.selectedHex,
        showDropLines: st.showDropLines,
        separationFt: st.separationFt,
        datumAltFt,
        dropToAltFt: (a) => {
          // Drop lines are now SELECTION-ONLY and go all the way to the surface (D-030).
          // Showing them for every contact is what forced the old "stop at the nearest band
          // floor" compromise, which left lines hanging in mid-air with nothing to land on.
          // One line, to the ground, is unambiguous.
          if (a.hex !== st.selectedHex) return null;
          return 0;
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

    /* --- places: static, so only ever shown or hidden --- */
    let lastShowPlaces = s0.showPlaces;
    const unsubPlaces = useStore.subscribe((st) => {
      if (st.showPlaces === lastShowPlaces) return;
      lastShowPlaces = st.showPlaces;
      places.setShow(st.showPlaces);
    });

    /* --- planes rebuild only when their inputs change --- */
    let lastKey = "";
    const unsub = useStore.subscribe((st) => {
      const sel = st.selectedHex ? st.aircraft.find((a) => a.hex === st.selectedHex) : undefined;
      // Pitch enters the key as a boolean, not a number: the slice is either drawn or it is
      // not, and keying on the raw angle would rebuild it on every degree of camera movement.
      const perspective = hasSlicePerspective(st.cameraPitchDeg);
      const key = [
        st.showDatum,
        perspective,
        st.datumRadiusNm,
        sel?.hex ?? "",
        sel?.alt_ft ?? "",
        sel ? `${sel.lat.toFixed(2)},${sel.lon.toFixed(2)}` : "",
      ].join("|");
      if (key === lastKey) return;
      lastKey = key;

      // The fixed 18k/29k band grids are gone (D-029). They occluded traffic, only answered
      // "above or below?" when the camera angle cooperated, and D-010 had already demoted
      // them to secondary context. Altitude now reads off the icon hue ramp; the slice below
      // remains the on-demand measuring instrument.
      //
      // The slice is not cleared and rebuilt: it moves with the selected contact on every
      // poll, and destroying its label that often corrupts Cesium's glyph atlas (upsertPlane).
      //
      // It is also suppressed when the camera has no useful perspective on it (D-034): from
      // plan view it is a sheet over the whole display, from the horizon a band across it.
      // Co-altitude amber on the icons is NOT suppressed - that is the readout which still
      // works at those angles, and it is the reason losing the slice geometry costs nothing.
      if (!(st.showDatum && perspective && sel?.alt_ft != null)) {
        clearByPrefix(viewer, DATUM_PREFIX);
      } else {
        upsertPlane(viewer, {
          id: `${DATUM_PREFIX}0`,
          lat: sel.lat,
          lon: sel.lon,
          radiusNm: st.datumRadiusNm,
          altFt: sel.alt_ft,
          colour: AMBER,
          label: `SLICE ${Math.round(sel.alt_ft).toLocaleString()} FT · ±${st.datumRadiusNm} NM`,
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
      unsubPlaces();
      scene.postRender.removeEventListener(onTick);
      handler.destroy();
      layer.destroy();
      places.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  return <div ref={ref} className="absolute inset-0" />;
}
