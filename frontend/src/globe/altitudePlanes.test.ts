/**
 * The upsert REUSE path, not the create path.
 *
 * `upsertPlane` mutates an existing entity rather than destroying and re-adding it, because
 * recreating a labelled entity thirty times a minute churns Cesium's glyph atlas badly enough to
 * drop characters out of an altitude readout. The hazard that discipline introduces is the
 * opposite one: a property the mutate branch forgets keeps the value it was CREATED with, for as
 * long as the entity lives.
 *
 * That is invisible while the palette is fixed - every call passes the same colour - and shows up
 * the moment anything changes it. These tests pin the reuse path to reapplying everything derived
 * from `s.colour`, so a theme switch cannot leave the datum half-repainted.
 */
import { Color, EntityCollection, JulianDate, type Viewer } from "cesium";
import { describe, expect, it } from "vitest";

import { upsertPlane, type PlaneSpec } from "./altitudePlanes";

const TIME = JulianDate.now();

/** Cesium's real EntityCollection - the property wrapping is exactly what is under test. */
function fakeViewer(): Viewer {
  return {
    entities: new EntityCollection(),
    clock: { currentTime: TIME },
  } as unknown as Viewer;
}

/** A datum plane over Mobile at 30,000 ft. */
const BASE: PlaneSpec = {
  id: "datum",
  lat: 30.6944,
  lon: -88.0399,
  radiusNm: 20,
  altFt: 30000,
  colour: Color.fromCssColorString("#5fd7e0"),
  label: "DATUM 30,000 FT",
  emphasis: true,
};

const RED = Color.fromCssColorString("#ff0000");

/** Compare ignoring alpha - each surface applies its own. */
function rgbOf(c: Color): [number, number, number] {
  return [c.red, c.green, c.blue];
}

describe("upsertPlane reuse path", () => {
  it("reuses the entities rather than recreating them", () => {
    const viewer = fakeViewer();
    const [plane, label] = upsertPlane(viewer, BASE);
    const [plane2, label2] = upsertPlane(viewer, { ...BASE, altFt: 31000 });

    // Identity, not just count: recreating would re-churn the glyph atlas.
    expect(plane2).toBe(plane);
    expect(label2).toBe(label);
    expect(viewer.entities.values.length).toBe(2);
  });

  it("repaints the fill when the colour changes", () => {
    const viewer = fakeViewer();
    upsertPlane(viewer, BASE);
    const [plane] = upsertPlane(viewer, { ...BASE, colour: RED });

    const material = plane.rectangle?.material as unknown as {
      color: { getValue(t: JulianDate): Color };
    };
    expect(rgbOf(material.color.getValue(TIME))).toEqual(rgbOf(RED));
  });

  it("repaints the outline when the colour changes", () => {
    const viewer = fakeViewer();
    upsertPlane(viewer, BASE);
    const [plane] = upsertPlane(viewer, { ...BASE, colour: RED });

    const outline = plane.rectangle?.outlineColor?.getValue(TIME) as Color;
    expect(rgbOf(outline)).toEqual(rgbOf(RED));
  });

  it("repaints the label when the colour changes", () => {
    const viewer = fakeViewer();
    upsertPlane(viewer, BASE);
    const [, label] = upsertPlane(viewer, { ...BASE, colour: RED });

    const fill = label.label?.fillColor?.getValue(TIME) as Color;
    expect(rgbOf(fill)).toEqual(rgbOf(RED));
  });

  it("swaps the material class when a solid plane becomes a grid", () => {
    const viewer = fakeViewer();
    const [plane] = upsertPlane(viewer, { ...BASE, fill: "solid" });
    const solid = plane.rectangle?.material?.constructor.name;

    upsertPlane(viewer, { ...BASE, fill: "grid" });
    const grid = plane.rectangle?.material?.constructor.name;

    // Recolouring in place could not do this - the two are different property classes.
    expect(solid).toBe("ColorMaterialProperty");
    expect(grid).toBe("GridMaterialProperty");
  });

  it("still updates the geometry and label text it always did", () => {
    const viewer = fakeViewer();
    upsertPlane(viewer, BASE);
    const [plane, label] = upsertPlane(viewer, { ...BASE, altFt: 31000, label: "DATUM 31,000 FT" });

    const FT_TO_M = 0.3048;
    expect(plane.rectangle?.height?.getValue(TIME)).toBeCloseTo(31000 * FT_TO_M, 3);
    expect(label.label?.text?.getValue(TIME)).toBe("[ DATUM 31,000 FT ]");
  });
});
