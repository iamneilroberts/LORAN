#!/usr/bin/env python3
"""Evaluate JS in a page via CDP and print the result. Dev utility."""
import asyncio, json, sys, urllib.request
import websockets


async def main(url, expr):
    new = json.load(urllib.request.urlopen(
        urllib.request.Request("http://localhost:9333/json/new?about:blank", method="PUT")))
    async with websockets.connect(new["webSocketDebuggerUrl"], max_size=100 * 1024 * 1024) as ws:
        i = [0]

        async def cmd(method, params=None):
            i[0] += 1
            await ws.send(json.dumps({"id": i[0], "method": method, "params": params or {}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == i[0]:
                    if "error" in m:
                        raise RuntimeError(m["error"])
                    return m.get("result", {})

        await cmd("Page.enable")
        await cmd("Runtime.enable")
        await cmd("Page.navigate", {"url": url})
        await asyncio.sleep(4)
        r = await cmd("Runtime.evaluate",
                      {"expression": expr, "awaitPromise": True, "returnByValue": True})
        print(json.dumps(r.get("result", {}).get("value"), indent=2, default=str))
        await cmd("Page.close")


asyncio.run(main(sys.argv[1], sys.argv[2]))
