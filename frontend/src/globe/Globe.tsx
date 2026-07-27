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
import { amber, clearByPrefix, upsertPlane } from "./altitudePlanes";
import { upsertCone } from "./projectionCone";
import {
  clearDestination, clearOrigin, upsertDestination, upsertOrigin,
} from "./destinationLine";
import { checkFiledOrigin, checkFiledRoute } from "../data/routeCheck";
import { applyTheme, palette } from "../styles/palette";
import { createAircraftLayer } from "./aircraftLayer";
import { createPlacesLayer } from "./placesLayer";
import { createBoundariesLayer } from "./boundariesLayer";
import { createRadarLayer } from "./radarLayer";
import { perfKnobs, perfStats } from "./perfKnobs";
import { api } from "../api";
import {
  DEFAULT_THEME, FT_TO_M, hasSlicePerspective, matchesFilter, useStore, type Aircraft,
} from "../state/store";

const DATUM_PREFIX = "datum::";
const CONE_PREFIX = "cone::";
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
    const pal = palette();
    scene.globe.baseColor = Color.fromCssColorString(pal.bg);
    scene.backgroundColor = Color.fromCssColorString(pal.bg);
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.enableLighting = false;
    scene.fog.enabled = false;
    // Aircraft and planes sit above the ellipsoid; terrain depth-testing clips them.
    scene.globe.depthTestAgainstTerrain = false;

    // Held, because a theme change has to re-request these tiles - see repaintTheme below.
    let bathymetry = scene.imageryLayers.addImageryProvider(new DarkBathymetryProvider());

    const layer = createAircraftLayer(scene);
    // Static ground reference, built once here and thereafter only shown or hidden (D-032).
    const places = createPlacesLayer(scene);
    // Weather radar builds nothing until it is switched on (D-040), so an off toggle costs
    // no tiles and no upstream requests at all.
    const radar = createRadarLayer(scene);
    // Boundaries are static too. Counties build lazily inside the layer on first show, so an
    // off toggle costs nothing but the states it was already going to draw (D-063).
    const boundaries = createBoundariesLayer(scene);
    const s0 = useStore.getState();
    places.setShow(s0.showPlaces);
    radar.setShow(s0.showRadar);
    boundaries.setShow(s0.showStates, s0.showCounties);

    /* --- open in perspective, not plan view --- */
    camera.setView({
      destination: Cartesian3.fromDegrees(s0.home.lon, s0.home.lat - 1.9, 145_000),
      orientation: {
        heading: CMath.toRadians(0),
        pitch: CMath.toRadians(-32),   // tilted: altitude is visible as height, not as nothing
        roll: 0,
      },
    });

    /* --- home moved: re-aim the camera (D-068) --- */
    // The fetch loop reads `home` imperatively every tick, so it re-centres on its own. The
    // camera does not - it is positioned once at mount - so without this the traffic would
    // move and the view would stay pointed at the old place, which reads as a broken feed.
    let lastHome = `${s0.home.lat},${s0.home.lon}`;
    const unsubHome = useStore.subscribe((st) => {
      const key = `${st.home.lat},${st.home.lon}`;
      if (key === lastHome) return;
      lastHome = key;
      // flyTo, not setView: an instant jump gives no sense of where it went. Same framing as
      // the opening view so the result looks like a fresh start rather than a nudge.
      camera.flyTo({
        destination: Cartesian3.fromDegrees(st.home.lon, st.home.lat - 1.9, 145_000),
        orientation: { heading: CMath.toRadians(0), pitch: CMath.toRadians(-32), roll: 0 },
        duration: 1.5,
      });
    });

    /* --- theme (D-066) --- */
    // Most of the globe rethemes for free: the aircraft icons are cached by colour STRING, and
    // the planes, cone and destination line re-derive their colours on every update tick, so
    // dropping the palette memo is enough for all of them. Only the two build-once layers and
    // the scene's own background have to be told.
    let lastTheme = s0.theme;
    const repaintTheme = (theme: string) => {
      applyTheme(theme, DEFAULT_THEME);
      const p = palette();
      scene.globe.baseColor = Color.fromCssColorString(p.bg);
      scene.backgroundColor = Color.fromCssColorString(p.bg);
      places.recolour();
      boundaries.recolour();
      // The bathymetry provider bakes --bg into the tiles it generates and Cesium caches them,
      // so nothing short of re-requesting repaints the water. Only THIS layer is swapped, by
      // its own reference - `imageryLayers.removeAll()` would also destroy the radar's layer
      // while radarLayer went on holding a reference to it, which is D-064's mistake again:
      // its `setShow(true)` would see a non-null `layer` and never rebuild, and its next
      // `drop()` would call remove() on a destroyed object.
      scene.imageryLayers.remove(bathymetry, true);
      bathymetry = scene.imageryLayers.addImageryProvider(new DarkBathymetryProvider());
      // Re-added on top, so put it back underneath the radar overlay where it belongs.
      scene.imageryLayers.lowerToBottom(bathymetry);
    };
    const unsubTheme = useStore.subscribe((st) => {
      if (st.theme === lastTheme) return;
      lastTheme = st.theme;
      repaintTheme(st.theme);
    });

    /* --- label decluttering, on camera SETTLE (D-065) --- */
    // moveEnd, not postRender: the pass projects every in-range label to window coordinates,
    // which is far too much to do 30 times a second, and labels cannot overlap differently
    // until the camera has actually moved. An initial run covers the opening view, which
    // produces no moveEnd of its own.
    //
    // Density and the small-airport tier both change what is in range without moving the
    // camera, so those call it too - see the places subscription below.
    const redeclutter = () => places.declutterLabels(scene);
    camera.moveEnd.addEventListener(redeclutter);
    // The FIRST pass waits for a render. Window projection needs a populated frame state, so
    // running it here - before anything has drawn - would fail for every label at once.
    let declutteredOnce = false;

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
          useStore.getState().setDepth(await api.depth(lat, lon), false);
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
    // Starts at -Infinity so the first tick always runs the update, whatever the throttle.
    let lastDrAt = -Infinity;

    const onTick = () => {
      const st = useStore.getState();
      if (!declutteredOnce) {
        declutteredOnce = true;
        redeclutter();
      }

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

      // Dead reckoning is the per-frame CPU cost, and by default it STILL runs every frame -
      // `drHz = 0` is exactly the behaviour that shipped. The probe route can throttle it to
      // measure what a phone would save (D-073). `elapsedS` comes from the last fetch's wall
      // clock rather than accumulating per frame, so skipping frames cannot make positions drift.
      const nowMs = performance.now();
      const minGapMs = perfKnobs.drHz > 0 ? 1000 / perfKnobs.drHz : 0;
      if (nowMs - lastDrAt >= minGapMs) {
        lastDrAt = nowMs;
        const drStart = performance.now();
        layer.update(visible, elapsedS, {
          selectedHex: st.selectedHex,
          showDropLines: st.showDropLines,
          separationFt: st.separationFt,
          datumAltFt,
          showAllLabels: st.showAllLabels,
          dropToAltFt: (a) => {
            // Drop lines are now SELECTION-ONLY and go all the way to the surface (D-030).
            // Showing them for every contact is what forced the old "stop at the nearest band
            // floor" compromise, which left lines hanging in mid-air with nothing to land on.
            // One line, to the ground, is unambiguous.
            if (a.hex !== st.selectedHex) return null;
            return 0;
          },
        });
        perfStats.drMs += performance.now() - drStart;
        perfStats.drCalls++;
      }

      frames++;
      perfStats.frames++;
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
          material: Color.fromCssColorString(palette().cyan).withAlpha(0.75),
          // The track is a measurement, not scenery: it must stay visible where it passes
          // behind terrain rather than being silently clipped into a shorter path.
          arcType: ArcType.GEODESIC,
        },
      });
    });

    /* --- places: static, so only ever shown or hidden --- */
    let lastShowPlaces = s0.showPlaces;
    let lastShowRadar = s0.showRadar;
    let lastDensity = s0.placeDensity;
    let lastSmall = s0.showSmallAirports;
    let lastStates = s0.showStates;
    let lastCounties = s0.showCounties;
    places.setDensity(lastDensity);
    if (lastSmall) places.setSmallAirports(true);
    const unsubPlaces = useStore.subscribe((st) => {
      if (st.showPlaces !== lastShowPlaces) {
        lastShowPlaces = st.showPlaces;
        places.setShow(st.showPlaces);
        redeclutter();
      }
      if (st.showStates !== lastStates || st.showCounties !== lastCounties) {
        lastStates = st.showStates;
        lastCounties = st.showCounties;
        boundaries.setShow(st.showStates, st.showCounties);
      }
      if (st.placeDensity !== lastDensity) {
        lastDensity = st.placeDensity;
        places.setDensity(st.placeDensity);
        redeclutter();
      }
      if (st.showSmallAirports !== lastSmall) {
        lastSmall = st.showSmallAirports;
        places.setSmallAirports(st.showSmallAirports);
      }
      if (st.showRadar !== lastShowRadar) {
        lastShowRadar = st.showRadar;
        radar.setShow(st.showRadar);
      }
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
        st.showProjection,
        st.projMinutes,
        st.projSpreadDeg,
        sel?.hex ?? "",
        sel?.alt_ft ?? "",
        // Track, speed and vertical rate all change the envelope's shape, so they belong in
        // the key. Rounded, because raw values differ every poll and would rebuild constantly.
        sel?.track_deg == null ? "" : Math.round(sel.track_deg),
        sel?.gs_kt == null ? "" : Math.round(sel.gs_kt / 5),
        Math.round((sel?.geom_rate_fpm ?? sel?.baro_rate_fpm ?? 0) / 100),
        sel ? `${sel.lat.toFixed(2)},${sel.lon.toFixed(2)}` : "",
        // The destination line depends on the enrichment reply, which lands well after the
        // selection does. Without it in the key the line would never appear for a contact
        // whose route arrives a moment later - which is all of them.
        st.showDestination,
        st.enrichment?.route?.destination?.lat ?? "",
        st.enrichment?.route?.destination?.lon ?? "",
        // Same reasoning for the backward leg (D-074): the origin arrives with the same late
        // enrichment reply, and without it here a route that has an origin but no destination
        // coordinates would never redraw at all.
        st.enrichment?.route?.origin?.lat ?? "",
        st.enrichment?.route?.origin?.lon ?? "",
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
          colour: amber(),
          label: `SLICE ${Math.round(sel.alt_ft).toLocaleString()} FT · ±${st.datumRadiusNm} NM`,
          emphasis: true,
          // Solid, not grid: a dense wireframe at a shallow viewing angle moires into
          // noise and stops reading as a surface, which is its only job.
          fill: "solid",
        });
      }

      /* --- dashed lines to the FILED route ends (D-050 forward, D-074 back) --- */
      // adsbdb knows the route for some flights and not others, and knows coordinates for
      // fewer still. No coordinates means nothing is drawn - never a guessed airport.
      const dest = st.enrichment?.route?.destination ?? null;
      const orig = st.enrichment?.route?.origin ?? null;
      // One toggle covers both legs: they are the same claim from the same schedule lookup.
      // The enrichment/selection hex guard is shared too - a reply for the previously selected
      // contact must never draw against the current one's position.
      const filedFor = st.showDestination && sel?.alt_ft != null
        && st.enrichment?.hex?.toUpperCase() === sel?.hex?.toUpperCase();
      // D-062: withdraw a leg when the observed track grossly disagrees with it. Drawing a
      // confident dashed arc to an airport the contact is demonstrably not flying to - or from
      // one it is demonstrably flying back towards - is the most emphatic way this display could
      // assert something false. The panel says why in words, and the globe stops claiming it in
      // geometry. Each leg is judged on its own evidence, so a stale destination does not
      // suppress an origin the track still supports.
      const routeVerdict = sel
        ? checkFiledRoute({
            lat: sel.lat, lon: sel.lon, trackDeg: sel.track_deg, altFt: sel.alt_ft,
            destLat: dest?.lat ?? null, destLon: dest?.lon ?? null,
          })
        : null;
      const originVerdict = sel
        ? checkFiledOrigin({
            lat: sel.lat, lon: sel.lon, trackDeg: sel.track_deg, altFt: sel.alt_ft,
            origLat: orig?.lat ?? null, origLon: orig?.lon ?? null,
          })
        : null;
      const destOk = filedFor
        && dest?.lat != null && dest?.lon != null
        && routeVerdict?.state !== "disagrees";
      if (!destOk) {
        clearDestination(viewer);
      } else {
        upsertDestination(viewer, {
          lat: sel.lat,
          lon: sel.lon,
          altFt: sel.alt_ft as number,
          destLat: dest.lat as number,
          destLon: dest.lon as number,
          code: dest.icao ?? dest.iata ?? "—",
        });
      }

      const originOk = filedFor
        && orig?.lat != null && orig?.lon != null
        && originVerdict?.state !== "disagrees";
      if (!originOk) {
        clearOrigin(viewer);
      } else {
        upsertOrigin(viewer, {
          lat: sel.lat,
          lon: sel.lon,
          altFt: sel.alt_ft as number,
          origLat: orig.lat as number,
          origLon: orig.lon as number,
          code: orig.icao ?? orig.iata ?? "—",
        });
      }

      /* --- forward projection envelope (D-047) --- */
      // Needs a track to point along and a speed to scale by. Without either there is nothing
      // honest to draw, so nothing is drawn.
      const canProject = st.showProjection && sel?.alt_ft != null
        && sel.track_deg != null && sel.gs_kt != null && sel.gs_kt > 0;
      if (!canProject) {
        clearByPrefix(viewer, CONE_PREFIX);
      } else {
        upsertCone(viewer, {
          id: CONE_PREFIX,
          lat: sel.lat,
          lon: sel.lon,
          trackDeg: sel.track_deg as number,
          gsKt: sel.gs_kt as number,
          altFt: sel.alt_ft as number,
          vsFpm: sel.geom_rate_fpm ?? sel.baro_rate_fpm ?? null,
          minutes: st.projMinutes,
          spreadDeg: st.projSpreadDeg,
        });
      }
    });

    return () => {
      window.clearTimeout(depthTimer);
      unsub();
      unsubTrack();
      unsubPlaces();
      unsubHome();
      unsubTheme();
      camera.moveEnd.removeEventListener(redeclutter);
      scene.postRender.removeEventListener(onTick);
      handler.destroy();
      layer.destroy();
      places.destroy();
      radar.destroy();
      boundaries.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  return <div ref={ref} className="absolute inset-0" />;
}
