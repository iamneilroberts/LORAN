#!/usr/bin/env python3
"""
Phase 1 acceptance check, driven through real browser input.

Every assertion goes through the same path a person would: dispatched mouse events, not
direct store pokes. A test that sets state behind the UI proves the store works, not the app.
"""
import asyncio, json, sys, urllib.request
import websockets

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
CDP = "http://localhost:9333"
SETTLE = int(sys.argv[2]) if len(sys.argv) > 2 else 80


async def main():
    new = json.load(urllib.request.urlopen(
        urllib.request.Request(f"{CDP}/json/new?about:blank", method="PUT")))
    results: list[tuple[str, bool, str]] = []

    async with websockets.connect(new["webSocketDebuggerUrl"], max_size=200 * 1024 * 1024) as ws:
        i = [0]

        async def cmd(method, params=None):
            i[0] += 1
            await ws.send(json.dumps({"id": i[0], "method": method, "params": params or {}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == i[0]:
                    if "error" in m:
                        raise RuntimeError(f"{method}: {m['error']}")
                    return m.get("result", {})

        async def js(expr):
            r = await cmd("Runtime.evaluate",
                          {"expression": expr, "awaitPromise": True, "returnByValue": True})
            return r.get("result", {}).get("value")

        def check(name, ok, detail=""):
            results.append((name, bool(ok), detail))
            print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""),
                  flush=True)

        await cmd("Page.enable")
        await cmd("Runtime.enable")
        await cmd("Emulation.setDeviceMetricsOverride",
                  {"width": 1500, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        await cmd("Page.navigate", {"url": URL})
        print(f"  settling {SETTLE}s (software GL is slow)...", flush=True)
        await asyncio.sleep(SETTLE)

        # 1. live data actually arrived
        n = await js("window.__store.getState().aircraft.length")
        src = await js("window.__store.getState().source")
        check("live ADS-B data present", (n or 0) > 0, f"{n} aircraft from {src}")

        # 2. altitudes are real and at true height
        alts = await js("JSON.stringify((()=>{const a=window.__store.getState().aircraft"
                        ".map(x=>x.alt_ft).filter(v=>typeof v==='number');"
                        "return {min:Math.min(...a),max:Math.max(...a),n:a.length};})())")
        check("altitude spread is real", alts and json.loads(alts)["max"] > 20000, alts)

        # 3. altitude is encoded in the ICON COLOUR, and the ramp actually varies.
        #
        # Replaces the old "band planes at 18k/29k" check: D-029 removed the fixed grids in
        # favour of a hue ramp on the icon, so that check now guards nothing. This one guards
        # the thing that replaced it - low and high contacts must not come out the same colour,
        # which is exactly how the previous luminance-only ramp failed.
        ramp = await js("""JSON.stringify((()=>{
          const s = window.__viewer.scene;
          let bbc=null;
          for(let i=0;i<s.primitives.length;i++){const p=s.primitives.get(i);
            if(p&&typeof p.length==='number'&&p.get&&p.length>0&&p.get(0).image!==undefined){bbc=p;break;}}
          if(!bbc) return {err:'no billboards'};
          // group icon images by the aircraft altitude they were drawn for
          const ac = window.__store.getState().aircraft.filter(a=>a.alt_ft!=null && !a.military);
          if (ac.length < 2) return {err:'too few civil contacts'};
          const sorted = [...ac].sort((x,y)=>x.alt_ft-y.alt_ft);
          const lo = sorted[0], hi = sorted[sorted.length-1];
          const hue = (img) => { const m = decodeURIComponent(img).match(/hsl\\((\\d+)/); return m?+m[1]:null; };
          let loHue=null, hiHue=null;
          const ell = s.globe.ellipsoid;
          for(let i=0;i<bbc.length;i++){
            const b=bbc.get(i), c=ell.cartesianToCartographic(b.position);
            const lat=c.latitude*180/Math.PI, lon=c.longitude*180/Math.PI;
            if(Math.abs(lat-lo.lat)+Math.abs(lon-lo.lon) < 0.05) loHue = hue(b.image);
            if(Math.abs(lat-hi.lat)+Math.abs(lon-hi.lon) < 0.05) hiHue = hue(b.image);
          }
          return {loAlt:lo.alt_ft, hiAlt:hi.alt_ft, loHue, hiHue,
                  spread: (loHue!=null&&hiHue!=null) ? Math.abs(loHue-hiHue) : null};
        })())""")
        r = json.loads(ramp) if ramp else {}
        check("altitude is encoded in icon hue, and the ramp varies",
              r.get("spread") is not None and r["spread"] >= 20,
              f"{r.get('loAlt')}ft hue {r.get('loHue')} vs {r.get('hiAlt')}ft hue {r.get('hiHue')}")

        # 4. camera is in perspective, not plan view
        pitch = await js("Math.round(window.__viewer.camera.pitch*180/Math.PI)")
        check("camera is tilted (3D perspective)", pitch is not None and -75 < pitch < -10,
              f"pitch {pitch}deg")

        # 5. basemap tiles are the DARK remap, not raw GEBCO
        px = await js("""(async()=>{const p=window.__viewer.scene.imageryLayers.get(0).imageryProvider;
          const c=await p.requestImage(65,105,8);const d=c.getContext('2d').getImageData(128,128,1,1).data;
          return JSON.stringify([d[0],d[1],d[2]]);})()""")
        dark = px and max(json.loads(px)) < 120
        check("basemap is dark-remapped bathymetry", dark, f"centre pixel {px}")

        # 6. cursor readout - dispatch a REAL mouse move over the globe
        for ev, extra in (("mouseMoved", {}),):
            await cmd("Input.dispatchMouseEvent",
                      {"type": ev, "x": 750, "y": 620, "button": "none", **extra})
        await asyncio.sleep(2.5)
        cur = await js("JSON.stringify(window.__store.getState().cursor)")
        check("cursor lat/lon populates on mouse move", cur and cur != "null", cur)

        await asyncio.sleep(3.0)   # debounced GEBCO lookup
        depth = await js("window.__store.getState().depthM")
        check("cursor depth/elev readout returns a real value", depth is not None,
              f"{depth} m")

        # 7. click an aircraft -> selection + datum plane. Find one on screen first.
        target = await js("""(()=>{
          const C = window.Cesium || undefined;
          const v = window.__viewer, s = v.scene;
          const list = window.__store.getState().aircraft.filter(a=>a.alt_ft!=null);
          for (const a of list) {
            const pos = s.globe.ellipsoid.cartographicToCartesian(
              new (Object.getPrototypeOf(s.camera.positionCartographic).constructor)(
                a.lon*Math.PI/180, a.lat*Math.PI/180, a.alt_ft*0.3048));
            const w = s.cartesianToCanvasCoordinates ? s.cartesianToCanvasCoordinates(pos) : null;
            if (!(w && w.x>60 && w.x<1440 && w.y>60 && w.y<840)) continue;
            // The point must actually belong to the globe canvas. The overlay panels are
            // pointer-events-auto, so a contact drawn BEHIND one cannot be clicked - the
            // panel eats the event and the canvas never sees it, which reads as "click did
            // not select" and was the whole of this check's intermittent failure.
            const el = document.elementFromPoint(Math.round(w.x), Math.round(w.y));
            if (!el || el.tagName !== "CANVAS") continue;
            return JSON.stringify({hex:a.hex, x:Math.round(w.x), y:Math.round(w.y),
                                   alt:a.alt_ft, mil:a.military});
          }
          return null;})()""")
        if not target:
            check("found an aircraft on screen to click", False, "none projected into viewport")
        else:
            t = json.loads(target)
            for ev in ("mouseMoved", "mousePressed", "mouseReleased"):
                await cmd("Input.dispatchMouseEvent", {
                    "type": ev, "x": t["x"], "y": t["y"], "button": "left",
                    "clickCount": 1 if ev != "mouseMoved" else 0})
                await asyncio.sleep(0.25)
            await asyncio.sleep(2.0)
            sel = await js("window.__store.getState().selectedHex")
            check("click selects an aircraft", sel is not None,
                  f"clicked {t['hex']} at ({t['x']},{t['y']}) -> selected {sel}")

            if sel:
                datum = await js(
                    "JSON.stringify(window.__viewer.entities.values"
                    ".filter(e=>String(e.id).startsWith('datum::')&&e.rectangle)"
                    ".map(e=>Math.round(e.rectangle.height.getValue()/0.3048)))")
                selalt = await js(
                    "(()=>{const s=window.__store.getState();"
                    "const a=s.aircraft.find(x=>x.hex===s.selectedHex);"
                    "return a?Math.round(a.alt_ft):null;})()")
                heights = json.loads(datum) if datum else []
                ok = len(heights) == 1 and selalt is not None and abs(heights[0] - selalt) <= 1
                check("datum plane appears at the selected aircraft's altitude", ok,
                      f"datum {heights} ft vs selected {selalt} ft")

        await cmd("Page.close")

    print()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"  {passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


sys.exit(asyncio.run(main()))
