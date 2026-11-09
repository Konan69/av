# av

Visuals that react to the track you are playing.

A visual that follows the live signal level changes every frame and can't know where the drop is. av reads a precomputed analysis of the track instead (sections, beats, downbeats, six separated stems, onsets, band energy) and drives a Three.js scene from it: a pose held through each eight-bar phrase, morphs on bars and section changes, drums on the light. Playback and visuals share one Web Audio clock, so a seek gives the same picture every time. It runs inside the [nw_wrld](https://github.com/aagentah/nw_wrld) dashboard and projector, ported from Electron to one browser tab.

av is a modified version of **nw_wrld** by the nw_wrld Contributors, licensed under GPL-3.0. The complete upstream tree at revision `a660a229d2413c48c3ca03bacf41421ff93e7836` (`0.7.0-beta`) is in `app/`. [`NOTICE`](NOTICE) lists every upstream file av changed or added. [`app/UPSTREAM.md`](app/UPSTREAM.md) describes the browser port.

![A terminal runs npm start. The Genome World module builds, Vite reports ready, and the app serves at http://127.0.0.1:5177/.](docs/media/hero.gif)

## Install

Node.js 20+ and a browser with WebGL 2. Analyzing new tracks needs a [Modal](https://modal.com) account; tracks that already have a genome play without it.

```sh
git clone <this-repo-url> av && cd av
npm ci
```

## Use

```sh
npm start        # http://127.0.0.1:5177/ : dashboard beside its projector
```

In the projector, choose an audio file and play it. With `VITE_GENOME_URL` set, a new track is sent to the analyzer and its genome cached in the browser by SHA-256; without it, give the projector the audio and its genome JSON. **Open projector** moves the visual to its own tab and keeps the track, position and view.

| Command | What it does |
| --- | --- |
| `npm run dev` | The same as `npm start`: the dev server on port 5177, with the Genome World module rebuilt on change. |
| `npm run build` | Builds the Genome World module into `nw/project/modules/GenomeWorld.js` and the web app into `app/dist/`. 73 s on the test machine, including the first `app/` install. |
| `npm run preview` | Serves the built app and the workspace API on `http://127.0.0.1:4173`. |
| `npm test` | Runs the player, module and web-host tests. 59 tests passed on the test machine. |
| `npm run check` | Type-checks `nw/` with `tsc`. |
| `npm run nw:setup`, `npm run nw:start` | The optional Electron route. See [`nw/README.md`](nw/README.md). |
| `npm run legacy:player` | The old standalone player in `player/`. It is not the main app. |
| `npm run test:visual -- --iteration <name>` | Records reference passages through Chrome for side-by-side review at `/reviews/`. |

To analyze tracks, deploy the analyzer once and point av at it:

```sh
cd genome && modal run modal_app.py::download_weights && modal deploy modal_app.py
VITE_GENOME_URL=<web endpoint URL> npm start
```

With [dj-organizer](https://github.com/Konan69/dj-organizer) running, `http://127.0.0.1:5177/visualizer.html?track=<id>` follows whatever its player is playing.

Environment variables: [docs/configuration.md](docs/configuration.md). The analyzer, the conductor, the module API and running the Rust waveform engine alone: [docs/internals.md](docs/internals.md).

## Limits

- **The analyzer is non-commercial.** The MuQ weights it downloads are licensed CC BY-NC 4.0, so a deployment of `genome/` may not be used commercially. EDMFormer's checkpoint is CC BY 4.0 and needs attribution. No weights ship in this repository. [`genome/MODELS.md`](genome/MODELS.md) lists every model and its license.
- No analyzer endpoint is built in. Without `VITE_GENOME_URL`, only tracks already in the library or supplied with their genome play.
- The browser client never sends `x-api-key`, and `modal_app.py` attaches no Modal secret. A deployed analyzer is open to anyone with its URL unless you change both.
- `dj-bridge.ts` accepts `now-playing` posts only from `localhost:8765` and `127.0.0.1:8765`, whatever `DJ_ORGANIZER_URL` says.
- The app needs its local server for the workspace API. A static host cannot serve the build.
- The web adapter has no native UDP OSC. Browser MIDI works after **Enable MIDI**.
- The analyzer feeds HTDemucs a mono decode copied to two channels, so separation gets no stereo cues.
- Genome World is an artistic mapping of music onto standing-wave patterns. It is not a physical cymatics simulation.
- Not run for this README: the Electron route (`nw:setup`, `nw:start`), the legacy player, `test:visual`, and a Modal deploy.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE). nw_wrld is GPL-3.0, Copyright (C) 2025 nw_wrld Contributors; its license is in [`app/LICENSE`](app/LICENSE). The analyzer's models carry their own licenses, listed in [`genome/MODELS.md`](genome/MODELS.md).
