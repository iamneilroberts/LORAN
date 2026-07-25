/*
 * Camera control cluster.
 *
 * Cesium's mouse bindings already do all of this (left-drag pans, wheel zooms, middle-drag or
 * ctrl+left-drag rotates and tilts), but they are undiscoverable. These are explicit controls
 * for the same operations, plus the two view presets that matter for judging altitude.
 */
import { Cartesian3, Math as CMath, type Viewer } from "cesium";
import { useStore } from "../state/store";

const HEADING_STEP = CMath.toRadians(15);
const PITCH_STEP = CMath.toRadians(8);
const ZOOM_FACTOR = 0.35;

function viewer(): Viewer | null {
  return (window as unknown as { __viewer?: Viewer }).__viewer ?? null;
}

/** Rotate around the point the camera is looking at, not around the camera itself. */
function orbit(dHeading: number, dPitch: number) {
  const v = viewer();
  if (!v) return;
  const c = v.camera;
  const centre = v.scene.globe.ellipsoid.cartographicToCartesian(c.positionCartographic);
  void centre;
  // Cesium's look* rotate the camera in place; rotating about the ellipsoid keeps the
  // subject centred, which is what you want when comparing contacts.
  if (dHeading) c.rotate(c.up, -dHeading);
  if (dPitch) c.rotate(c.right, dPitch);
}

function zoom(inward: boolean) {
  const v = viewer();
  if (!v) return;
  const h = v.camera.positionCartographic.height;
  v.camera.zoomIn(inward ? h * ZOOM_FACTOR : -h * ZOOM_FACTOR);
}

/** Change camera altitude without changing where it is looking. */
function climb(up: boolean) {
  const v = viewer();
  if (!v) return;
  const c = v.camera;
  const carto = c.positionCartographic.clone();
  const delta = Math.max(2000, carto.height * 0.3);
  const target = Math.max(1500, carto.height + (up ? delta : -delta));
  const heading = c.heading;
  const pitch = c.pitch;
  c.setView({
    destination: Cartesian3.fromRadians(carto.longitude, carto.latitude, target),
    orientation: { heading, pitch, roll: 0 },
  });
}

function preset(kind: "perspective" | "plan" | "horizon") {
  const v = viewer();
  if (!v) return;
  const { home } = useStore.getState();
  const spec = {
    // The default: tilted enough that altitude reads as height.
    perspective: { lat: home.lat - 1.9, h: 145_000, pitch: -32 },
    // Straight down. Good for horizontal separation, useless for altitude - which is the
    // whole reason the default is not this.
    plan: { lat: home.lat, h: 220_000, pitch: -89.9 },
    // Nearly edge-on. The clearest view of who is stacked above whom.
    horizon: { lat: home.lat - 2.6, h: 42_000, pitch: -9 },
  }[kind];

  v.camera.flyTo({
    destination: Cartesian3.fromDegrees(home.lon, spec.lat, spec.h),
    orientation: { heading: 0, pitch: CMath.toRadians(spec.pitch), roll: 0 },
    duration: 1.1,
  });
}

function Btn({
  onClick, title, children, wide,
}: {
  onClick: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        font: "inherit", fontSize: 11, lineHeight: 1,
        background: "transparent", color: "var(--cyan)", cursor: "pointer",
        border: "1px solid var(--line-bright)", borderRadius: 0,
        padding: wide ? "5px 0" : 0, height: wide ? undefined : 22,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

export function CameraCluster() {
  const cell = { display: "grid", gap: 2 } as const;

  return (
    <div className="panel p-[6px] w-[168px] pointer-events-auto">
      <div className="lbl px-[3px] pb-1">Camera</div>

      {/* orbit / tilt pad */}
      <div style={{ ...cell, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <span />
        <Btn onClick={() => orbit(0, PITCH_STEP)} title="Tilt down (look more from above)">▲</Btn>
        <span />
        <Btn onClick={() => orbit(-HEADING_STEP, 0)} title="Rotate left">◀</Btn>
        <Btn onClick={() => preset("perspective")} title="Reset to default perspective">◎</Btn>
        <Btn onClick={() => orbit(HEADING_STEP, 0)} title="Rotate right">▶</Btn>
        <span />
        <Btn onClick={() => orbit(0, -PITCH_STEP)} title="Tilt up (look more edge-on)">▼</Btn>
        <span />
      </div>

      <div style={{ ...cell, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
        <Btn onClick={() => zoom(true)} title="Zoom in">＋</Btn>
        <Btn onClick={() => zoom(false)} title="Zoom out">－</Btn>
        <Btn onClick={() => climb(true)} title="Raise camera altitude">ALT ▲</Btn>
        <Btn onClick={() => climb(false)} title="Lower camera altitude">ALT ▼</Btn>
      </div>

      <div style={{ ...cell, marginTop: 4 }}>
        <Btn wide onClick={() => preset("horizon")} title="Edge-on: best for reading who is stacked above whom">
          HORIZON VIEW
        </Btn>
        <Btn wide onClick={() => preset("plan")} title="Straight down: horizontal separation only, no altitude">
          PLAN VIEW
        </Btn>
      </div>
    </div>
  );
}
