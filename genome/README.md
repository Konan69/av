# Genome Analyzer

Serverless GPU analysis of EDM tracks → `genome.json` for the AV engine.

**No local downloads, no local GPU needed.** All heavy models run on Modal
(serverless GPU, per-second billing, scales to zero when idle).

## What it does

Upload a track → get its full **genome**: sections (with raw probability
curves), beat + downbeat grid, waveform envelopes, 5-band energy/flux,
onset events, wobble tracker, tension curve. See [SCHEMA.md](SCHEMA.md).

## Architecture

```
browser/CLI ──upload──► Modal (T4 GPU) ──► genome.json
                          │
                          ├─ EDMFormer head        418MB  (volume)
                          ├─ MusicFM backbone      1.3GB  (volume)
                          ├─ MuQ embeddings        HF     (volume cache)
                          ├─ htdemucs_6s           ~330MB (volume cache)
                          └─ genome-engine (Rust)  run on the mix AND
                                                   on each separated stem
```

Weights download **once** into a persistent Modal Volume. Analysis is
~30–90s warm on a T4 (~$0.01/track). Results are content-hash cached —
re-analyzing the same file is instant and free.

## Setup (one time)

```bash
cd genome
modal run modal_app.py::download_weights   # fetch ~2GB weights → volume
modal deploy modal_app.py                  # deploy HTTP endpoint
```

Modal prints the endpoint URL on deploy:
`https://<workspace>--genome-analyzer-analyzer-analyze-http.modal.run`

Endpoint (deployed 2026-08-29):
`https://YOUR-WORKSPACE--genome-analyzer-analyzer-web.modal.run` — `POST /analyze`
(multipart `file`), `GET /health`. CORS is open so the player calls it directly.

## Analyze a track

The player does this for you on drop. From the CLI:

```bash
python scripts/analyze.py "/path/to/track.m4a" \
  --url https://YOUR-WORKSPACE--genome-analyzer-analyzer-web.modal.run/analyze
```

## Roadmap

- [x] EDMFormer section analysis (raw curves, no rule post-processing)
- [x] Beat This! neural beat + downbeat grid
- [x] Rust waveform engine (envelopes, bands, onsets, wobble, tension)
- [x] Symphonia universal decode (any format → analysis + 44.1k WAV)
- [x] 6-stem separation (htdemucs_6s) + per-stem waveform analysis — the
      discovered layer voices the player binds to
- [x] The web player: drop one audio file, it hashes, analyzes (once ever,
      cached both server- and browser-side) and plays the world
- [ ] Tempo octave disambiguation (Rust onset autocorr cross-check)
