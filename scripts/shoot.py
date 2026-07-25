#!/usr/bin/env python3
"""Screenshot a URL via an already-running Chrome on :9222 (CDP). Dev utility."""
import asyncio, base64, json, os, sys, urllib.request
import websockets


async def shoot(url, out, w=1600, h=1000, full=False, clicks=(), settle=1.2, wait=0):
    tabs = json.load(urllib.request.urlopen("http://localhost:9333/json"))
    tgt = urllib.request.urlopen(
        "http://localhost:9333/json/new?" + urllib.parse.quote(url, safe=":/?=&")
    ) if False else None
    # create a fresh tab
    new = json.load(urllib.request.urlopen(
        urllib.request.Request("http://localhost:9333/json/new?about:blank", method="PUT")))
    ws_url = new["webSocketDebuggerUrl"]

    async with websockets.connect(ws_url, max_size=200 * 1024 * 1024) as ws:
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

        await cmd("Page.enable")
        await cmd("Runtime.enable")
        await cmd("Log.enable")
        await cmd("Emulation.setDeviceMetricsOverride",
                  {"width": w, "height": h, "deviceScaleFactor": 2, "mobile": False})
        await cmd("Page.navigate", {"url": url})
        await asyncio.sleep(settle + 1.5)
        if wait:
            print(f"  settling {wait}s for tiles...", flush=True)
            await asyncio.sleep(wait)

        for js in clicks:
            r = await cmd("Runtime.evaluate", {"expression": js, "returnByValue": True})
            print("  click:", js[:60], "->", r.get("result", {}).get("value"))
            await asyncio.sleep(0.7)

        # Real console + exception capture. Drain whatever the page emitted.
        msgs = []
        try:
            while True:
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.25))
                meth = m.get("method")
                if meth == "Runtime.consoleAPICalled":
                    p = m["params"]
                    if p.get("type") in ("error", "warning"):
                        txt = " ".join(str(a.get("value", a.get("description", "")))
                                       for a in p.get("args", []))
                        msgs.append(f"[{p['type']}] {txt[:300]}")
                elif meth == "Runtime.exceptionThrown":
                    d = m["params"]["exceptionDetails"]
                    msgs.append("[exception] " + (d.get("exception", {}).get("description")
                                                  or d.get("text", ""))[:400])
                elif meth == "Log.entryAdded":
                    e = m["params"]["entry"]
                    if e.get("level") in ("error", "warning"):
                        msgs.append(f"[{e['level']}] {e.get('text','')[:300]}")
        except asyncio.TimeoutError:
            pass
        if msgs:
            print("  CONSOLE:")
            for m in msgs[:15]:
                print("   ", m)
        else:
            print("  console: clean")

        res = await cmd("Page.captureScreenshot",
                        {"format": "png", "captureBeyondViewport": bool(full)})
        open(out, "wb").write(base64.b64decode(res["data"]))
        print(f"  wrote {out}")
        await cmd("Page.close")


if __name__ == "__main__":
    import urllib.parse
    url, out = sys.argv[1], sys.argv[2]
    w = int(sys.argv[3]) if len(sys.argv) > 3 else 1600
    h = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
    wait = float(os.environ.get("SHOOT_WAIT", "0"))
    clicks = sys.argv[5:] if len(sys.argv) > 5 else []
    asyncio.run(shoot(url, out, w, h, clicks=clicks, wait=wait))
