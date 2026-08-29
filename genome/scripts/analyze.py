#!/usr/bin/env python3
"""CLI client for the deployed genome analyzer (genome v2).

Usage:
  python scripts/analyze.py <audio-file> [--url ENDPOINT] [--key API_KEY]

Saves <track>.genome.json next to the input and prints a summary.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def post_multipart(url: str, file_path: Path, api_key: str | None) -> dict:
    boundary = uuid.uuid4().hex
    filename = file_path.name
    data = file_path.read_bytes()

    body = b"\r\n".join(
        [
            f"--{boundary}".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode(),
            b"Content-Type: application/octet-stream",
            b"",
            data,
            f"--{boundary}--".encode(),
            b"",
        ]
    )

    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if api_key:
        headers["x-api-key"] = api_key

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"server error {e.code}: {e.read().decode()[:500]}")
    except json.JSONDecodeError as e:
        sys.exit(f"invalid JSON from server: {e}")


def main():
    parser = argparse.ArgumentParser(description="Build a track's genome")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", required=True, help="analyze_http endpoint URL")
    parser.add_argument("--key", default=None, help="API key if configured")
    args = parser.parse_args()

    if not args.audio.exists():
        sys.exit(f"file not found: {args.audio}")

    print(f"analyzing {args.audio.name} ...")
    g = post_multipart(args.url, args.audio, args.key)

    out = args.audio.with_suffix(".genome.json")
    out.write_text(json.dumps(g))

    beats = g.get("beats") or {}
    sections = g.get("sections", {})
    print(f"\n{'label':<12} {'start':>8} {'end':>8}")
    print("-" * 30)
    for seg in sections.get("hard", []):
        print(f"{seg['label']:<12} {seg['start']:>8.2f} {seg['end']:>8.2f}")
    print(f"\nbpm: {beats.get('bpm')}  |  beats: {len(beats.get('beats', []))}  "
          f"|  downbeats: {len(beats.get('downbeats', []))}")
    if beats.get("error"):
        print(f"beat tracking error: {beats['error']}")
    print(f"onsets: {len(g.get('onsets', []))}  |  "
          f"tension frames: {len(g.get('tension', {}).get('curve', []))}  |  "
          f"cached: {g.get('cached')}")
    print(f"\nsaved -> {out}")


if __name__ == "__main__":
    main()
