#!/usr/bin/env python3
"""
AIS coverage probe — a DIAGNOSTIC, not application code.

Answers one question: does aisstream.io actually see vessels in a given bounding box?
Reports raw observed counts only. It never infers, fills gaps, or synthesizes.
A zero result is a real answer and is reported as zero.

Usage:
    python3 scripts/ais_coverage_probe.py --name "Mobile Bay" \
        --bbox 30.1 -88.4 31.0 -87.8 --duration 180

    # Known-dense control, to prove the tooling and key work:
    python3 scripts/ais_coverage_probe.py --name "Gulf of Finland (control)" \
        --bbox 59.0 20.0 60.5 26.0 --duration 120

Requires AISSTREAM_API_KEY in .env (gitignored). Free key: https://aisstream.io
"""
import argparse, asyncio, json, os, re, sys, time
from collections import Counter, defaultdict

try:
    import websockets
except ImportError:
    sys.exit("pip install websockets")

ENV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def load_key():
    try:
        t = open(ENV).read()
    except FileNotFoundError:
        sys.exit(f"no .env at {ENV}")
    m = re.search(r"^\s*AISSTREAM_API_KEY\s*=\s*(.+)$", t, re.M)
    if not m or not m.group(1).strip():
        sys.exit("AISSTREAM_API_KEY missing or empty in .env")
    return m.group(1).strip().strip('"').strip("'")


async def probe(name, bbox, duration, out):
    key = load_key()
    msg_types, positions, static = Counter(), defaultdict(int), {}
    latlons, errors, total = [], [], 0
    started = time.time()

    try:
        async with websockets.connect("wss://stream.aisstream.io/v0/stream",
                                      ping_interval=20, close_timeout=5) as ws:
            # aisstream closes the socket if the subscription is not sent within 3s.
            await ws.send(json.dumps({
                "APIKey": key,
                "BoundingBoxes": [bbox],
                "FilterMessageTypes": ["PositionReport", "ShipStaticData",
                                       "StandardClassBPositionReport",
                                       "ExtendedClassBPositionReport"],
            }))
            print(f"[{name}] subscribed bbox={bbox} for {duration}s", flush=True)

            while time.time() - started < duration:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=30)
                except asyncio.TimeoutError:
                    print(f"  [{int(time.time()-started)}s] silent 30s "
                          f"(total {total})", flush=True)
                    continue
                try:
                    m = json.loads(raw)
                except json.JSONDecodeError:
                    errors.append(raw[:200]); continue
                if "error" in m:
                    errors.append(str(m)[:300]); print("  ERROR:", m, flush=True); break

                mt = m.get("MessageType", "?")
                msg_types[mt] += 1; total += 1
                meta = m.get("MetaData") or m.get("Metadata") or {}
                mmsi = meta.get("MMSI") or meta.get("mmsi")
                body = (m.get("Message") or {}).get(mt) or {}

                if "PositionReport" in mt or "ClassBPosition" in mt:
                    positions[mmsi] += 1
                    la = body.get("Latitude", meta.get("latitude"))
                    lo = body.get("Longitude", meta.get("longitude"))
                    if la is not None and lo is not None:
                        latlons.append((la, lo))
                if mt == "ShipStaticData":
                    static[mmsi] = {"name": (body.get("Name") or "").strip(),
                                    "type": body.get("Type"),
                                    "destination": (body.get("Destination") or "").strip()}
    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
        print("  EXCEPTION:", e, flush=True)

    elapsed = time.time() - started
    lats = [p[0] for p in latlons]; lons = [p[1] for p in latlons]
    report = {
        "name": name, "bbox": bbox, "elapsed_s": round(elapsed, 1),
        "total_messages": total,
        "msgs_per_sec": round(total / elapsed, 3) if elapsed else 0,
        "message_types": dict(msg_types),
        "distinct_vessels_with_position": len(positions),
        "distinct_vessels_with_static": len(static),
        "static_coverage_pct": round(100 * len(static) / len(positions), 1) if positions else 0,
        "position_extent": {
            "lat_min": min(lats) if lats else None, "lat_max": max(lats) if lats else None,
            "lon_min": min(lons) if lons else None, "lon_max": max(lons) if lons else None,
        },
        "errors": errors[:5],
    }
    print(json.dumps(report, indent=2, default=str))
    if out:
        with open(out, "w") as f:
            json.dump(report, f, indent=2, default=str)
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="probe")
    ap.add_argument("--bbox", nargs=4, type=float, required=True,
                    metavar=("LAT1", "LON1", "LAT2", "LON2"))
    ap.add_argument("--duration", type=int, default=180)
    ap.add_argument("--out")
    a = ap.parse_args()
    asyncio.run(probe(a.name, [[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]],
                      a.duration, a.out))
