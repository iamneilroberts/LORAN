#!/usr/bin/env python3
"""
Capture the README screenshot set from the RUNNING app, against live traffic.

Ground rule 1 applies to documentation too: every image in the README is a real capture of
real data. Nothing here is mocked, composited or retouched. If a feed is down when this runs,
the screenshots will honestly show the offline state, and they should not be committed.

    bash scripts/serve.sh                       # in another shell
    python3 scripts/shoot_readme.py [BASE_URL]  # default http://127.0.0.1:8010

Needs a Chrome with remote debugging on :9333 (same one scripts/shoot.py uses). If the
instance has access tokens configured, put the owner link in LORAN_OWNER_URL so the capture
can authenticate, e.g.
    LORAN_OWNER_URL='http://127.0.0.1:8010/?t=TOKEN' python3 scripts/shoot_readme.py
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "screenshots"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"
OWNER_URL = os.environ.get("LORAN_OWNER_URL", BASE + "/")
CDP = "http://localhost:9333"
# Tall enough that the whole dossier fits - it scrolls internally, and a screenshot of a
# clipped panel makes the app look broken rather than dense.
W, H = 1600, 1150


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    new = json.load(urllib.request.urlopen(
        urllib.request.Request(CDP + "/json/new?about:blank", method="PUT")))

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

        async def shot(name: str) -> None:
            res = await cmd("Page.captureScreenshot", {"format": "png"})
            p = OUT_DIR / name
            p.write_bytes(base64.b64decode(res["data"]))
            print(f"  wrote {p.relative_to(ROOT)} ({p.stat().st_size // 1024} KB)")

        await cmd("Page.enable")
        await cmd("Runtime.enable")
        # 1x, not 2x: a README does not need 4x the bytes, and the repo carries these forever.
        await cmd("Emulation.setDeviceMetricsOverride",
                  {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False})
        await cmd("Page.navigate", {"url": OWNER_URL})
        print("settling for tiles and a first poll (software GL is slow)...")
        await asyncio.sleep(22)

        count = await js("window.__store.getState().aircraft.length")
        if not count:
            print("!! no live contacts - refusing to write screenshots of an empty feed")
            return 1
        print(f"  live contacts: {count}")

        # 1. the resting display
        await shot("01-globe.png")

        # 2. a selected contact: dossier, track and drop line
        # Pick the contact nearest the middle of the screen, not merely the first in the list:
        # the ALTITUDE SLICE and drop line are drawn AT the contact, so an off-frame selection
        # produces a dossier with none of the geometry it is describing.
        picked = await js("""(()=>{
          const s = window.__store.getState(), v = window.__viewer, sc = v.scene;
          const Carto = Object.getPrototypeOf(sc.camera.positionCartographic).constructor;
          const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
          let best = null, bestD = Infinity;
          for (const a of s.aircraft) {
            if (a.alt_ft == null || !a.flight) continue;
            const p = sc.globe.ellipsoid.cartographicToCartesian(
              new Carto(a.lon*Math.PI/180, a.lat*Math.PI/180, a.alt_ft*0.3048));
            const w = sc.cartesianToCanvasCoordinates(p);
            if (!w || w.x < 60 || w.x > window.innerWidth - 380 || w.y < 60
                || w.y > window.innerHeight - 80) continue;
            const d = (w.x-cx)**2 + (w.y-cy)**2;
            if (d < bestD) { bestD = d; best = a; }
          }
          if (!best) return null;
          s.select(best.hex);
          return best.flight || best.hex;
        })()""")
        print(f"  selected: {picked}")
        await asyncio.sleep(9)          # let enrichment + photo land
        await shot("02-dossier.png")

        # 3. weather radar over whatever is actually happening right now
        await js("(()=>{const s=window.__store.getState(); if(!s.showRadar) s.toggle('showRadar');})()")
        await asyncio.sleep(14)
        await shot("03-radar.png")
        await js("(()=>{const s=window.__store.getState(); if(s.showRadar) s.toggle('showRadar');})()")

        # 4. an airfield detail panel. Pick a military field so the honesty note is visible.
        await js("""(()=>{
          const v = window.__viewer, s = v.scene;
          const Carto = Object.getPrototypeOf(s.camera.positionCartographic).constructor;
          // NAS Pensacola, in view from the default camera
          v.camera.setView({
            destination: s.globe.ellipsoid.cartographicToCartesian(new Carto(
              -87.3186*Math.PI/180, 29.9*Math.PI/180, 90000)),
            orientation: { heading: 0, pitch: -30*Math.PI/180, roll: 0 },
          });
        })()""")
        await asyncio.sleep(10)
        # Several military fields, and both the marker and its label, because AIRCRAFT WIN the
        # pick by design - an icon sitting over the marker will take the click. Retry until a
        # place is actually selected rather than shipping a screenshot with no panel in it.
        fields = [("KNPA", 30.3527, -87.3186), ("KNSE", 30.7218, -87.0219),
                  ("KNDZ", 30.7017, -87.0231), ("KPNS", 30.4734, -87.1866)]
        who = None
        for ident, flat, flon in fields:
            for dx in (0, 15, 30):
                hit = await js(f"""(()=>{{
                  const v = window.__viewer, s = v.scene;
                  const Carto = Object.getPrototypeOf(s.camera.positionCartographic).constructor;
                  const pos = s.globe.ellipsoid.cartographicToCartesian(
                    new Carto({flon}*Math.PI/180, {flat}*Math.PI/180, 0));
                  const w = s.cartesianToCanvasCoordinates(pos);
                  if (!w) return null;
                  const x = Math.round(w.x) + {dx}, y = Math.round(w.y);
                  const el = document.elementFromPoint(x, y);
                  return JSON.stringify({{x, y, tag: el ? el.tagName : null}});
                }})()""")
                if not hit:
                    continue
                h = json.loads(hit)
                if h["tag"] != "CANVAS":
                    continue
                for ev in ("mouseMoved", "mousePressed", "mouseReleased"):
                    await cmd("Input.dispatchMouseEvent", {
                        "type": ev, "x": h["x"], "y": h["y"], "button": "left",
                        "clickCount": 0 if ev == "mouseMoved" else 1})
                    await asyncio.sleep(0.25)
                await asyncio.sleep(2)
                who = await js("(()=>{const p=window.__store.getState().selectedPlace;"
                               "return p ? p.ident : null;})()")
                if who:
                    break
            if who:
                break
        print(f"  airfield selected: {who}")
        if not who:
            print("  !! no airfield panel - 04 would show nothing; not writing it")
            await cmd("Page.close")
            return 1
        await shot("04-airfield.png")

        await cmd("Page.close")
        return 0


sys.exit(asyncio.run(main()))
