# How av works

![The data flow. An audio file from the projector or the /api/dj proxy goes to MusicSession, which hashes it with SHA-256. A cached genome comes from the IndexedDB library. Otherwise MusicSession posts the file to the analyzer on a Modal T4 GPU. The Conductor reads the v3 genome and sends signals to GenomeWorld, the Three.js scene inside nw_wrld.](media/diagram.png)

`MusicSession` (`player/src/session.ts`) owns the audio clock, the analysis request and the current performance. It hashes the audio with SHA-256 and looks the hash up in the browser's IndexedDB library (`player/src/library.ts`). On a miss, `player/src/analyzer.ts` posts the file to `$VITE_GENOME_URL/analyze` and stores the returned genome with the audio. The genome must carry the same `track_sha256`, or the session rejects it.

The analyzer is `genome/modal_app.py`, a Modal app on a T4 GPU. It runs EDMFormer for sections, Beat This! for beats and downbeats, HTDemucs (`htdemucs_6s`) for six stems, and the Rust waveform engine in `genome/engine/` on the mix and on each stem. It caches results by the file's SHA-256. [`genome/SCHEMA.md`](../genome/SCHEMA.md) describes the output.

`Conductor` (`player/src/conductor.ts`) reads the genome as a score with lookahead. It samples every output at absolute audio time. `MusicWorld` (`player/src/world/MusicWorld.ts`) draws the scene, and `nw/src/GenomeWorld.ts` hosts it as an nw_wrld module. The module build injects nw_wrld's own Three.js r159, so the scene shares one Three.js copy with the host.

The module exposes these methods to the nw_wrld dashboard: `loadTrack({ audio, genome })`, `playTrack`, `pauseTrack`, `seekTrack({ seconds })`, `setFeel({ punch, bass, detail, glow })`, `setView({ azimuth, elevation, distance })` and `showControls({ visible })`. Asset paths are relative to the workspace's `assets/` directory.

## Run the waveform engine locally

The waveform engine needs no GPU. It decodes any audio format through Symphonia, resamples to 44.1 kHz and writes envelopes, five bands (`sub`, `low`, `mid`, `high`, `air`), chroma, onsets, wobble and tension as JSON. The optional third argument writes the 44.1 kHz WAV that Beat This! reads.

```sh
cd genome/engine
cargo build --release --locked
./target/release/genome-engine track.wav track.json track.44k.wav
```

The build took 3 min 7 s on the test machine. On a 16 s test signal of 55 Hz kicks at 128 BPM, made with `ffmpeg`, the engine printed this in 0.49 s:

```text
genome-engine: 16.0s @44100Hz -> 34 onsets, written to kick-128bpm.json
```

## Deploy the analyzer

```sh
cd genome
modal run modal_app.py::download_weights   # downloads the model weights into the genome-weights Volume
modal deploy modal_app.py
```

Modal prints the URL of the `web` endpoint. It serves `POST /analyze` (multipart field `file`) and `GET /health`. Set `VITE_GENOME_URL` to that URL without `/analyze`, then start or build av. To analyze a file from the command line:

```sh
python3 genome/scripts/analyze.py track.m4a --url <web endpoint URL>/analyze
```

It writes `track.genome.json` next to the input.

## Follow a dj-organizer library

`app/web/dj-bridge.ts` proxies a local dj-organizer server. `GET /api/dj/tracks` lists its library and `GET /api/dj/audio/:id` streams a track. dj-organizer's player posts to `POST /api/dj/now-playing`, and the visualizer follows it over server-sent events at `GET /api/dj/now-playing/events`. The bridge only reads from the library. `http://127.0.0.1:5177/visualizer.html?track=<id>` opens the scene full screen, without the nw_wrld shell. Without dj-organizer running, `/api/dj/tracks` answers `503` with `{"error":"DJ library (dj-organizer on :8765) is not running"}`.
