# AV / nw_wrld

This project is based on nw_wrld's actual dashboard, track composer, module system, and projector. Its source is vendored in `app/` at a pinned upstream revision. The web adapter runs that application in the browser and stores its workspace on the local server; Electron is not required.

**Genome World** extends nw_wrld with a 3D cymatic nodal field. Standing-wave modes form patterns in world coordinates, with kaleidoscopic mirror symmetry applied before the camera rays traverse the field. The analyzer and conductor map discovered stems, rhythm, sections, and transients into modes, morphs, and excitation. This is an artistic mapping of music into a spatial wave field, not a calibrated physical cymatics simulation.

Phrase summaries set the standing-wave modes and hold their poses through phrase interiors. Scheduled bar and section transitions morph between poses. Fast drum events change the light; bass adds bounded local flex. Raw frame-by-frame RMS does not rewrite the whole topology.

```sh
npm ci
npm start
```

Open **http://localhost:5177**. First start installs the web host dependencies if needed and builds the Genome World module. The actual nw_wrld dashboard opens beside its projector, with the Genome World track selected. Choose an audio file in the projector to analyze and play it, or provide matching audio and a v3 genome JSON. The module keeps playback and visuals on one Web Audio clock.

The projector's controls adjust the view and musical response. The dashboard's four channels map to **play**, **pause**, **hide controls**, and **show controls**. Its constructor/method editor and starter modules remain available. Use **Open projector** to move the visual into a separate tab. The embedded preview is disposed before the new projector starts. The selected track, position, view, and feel controls carry across and return to the preview when the tab closes. If the browser blocks autoplay after the move, press **Play** in the projector.

```sh
npm run setup    # install web host dependencies explicitly
npm run dev      # nw_wrld web dashboard + projector, with module hot reload
npm run build    # bundle Genome World and build the actual nw_wrld web app
npm run preview  # serve built host and workspace API on localhost:4173
npm test
```

Configuration, module edits, and assets live in the ignored `nw/project/` workspace. Setup only copies missing defaults and preserves dashboard edits. Set `NW_WRLD_PROJECT_DIR` to use a different local workspace. The server is needed for workspace persistence in both development and preview; this build is not a static-only deployment.

**Enable MIDI** requests browser MIDI access explicitly. Select a device in nw_wrld's input settings to route its events. Browser audio inputs also remain available. Native UDP OSC requires a separate bridge and is not implemented by the web adapter.

- `app/src/`: actual nw_wrld source; see [upstream provenance](app/UPSTREAM.md).
- `app/web/`: browser bridge, projector/sandbox transport, and local workspace server.
- `nw/src/GenomeWorld.ts`: module hosting the shared musical world.
- `player/src/world/`: shared 3D world implementation used by Genome World.
- [Analyzer service](genome/README.md), [optional Electron integration](nw/README.md), [original vision](VISION.md).

The old standalone player remains available through `npm run legacy:player`; it is not the main application.

## Recorded visual iterations

Open **http://localhost:5177/reviews/** to play saved tests and compare the same musical passage across versions. Every visual iteration must be recorded; this is also documented in `AGENTS.md`.

Install `ffmpeg` and `ffprobe` for seekable videos and media validation. With the app running and the existing headed Chrome available on CDP port 9334:

```sh
node scripts/build-module.mjs
npm run test:visual -- --iteration 02-describe-the-change
```

The recorder runs the tests, then records three passages of the local reference reference track with its actual audio: intro, buildup into the first drop, and breakdown into the second drop. Use `--clips name:start:duration,...` for additional cases, including a full-track take: `npm run test:visual -- --iteration full-track --clips full-track:0:201`. Audio and v3 analysis paths can be overridden with `--audio` and `--genome`; they are relative to the workspace assets directory.

Add `--parallax` to append a separate **Scripted 3D parallax test** at track time 60–72 seconds. It sets azimuth to 0°, +12°, −12°, and 0° and camera distance to 0, +1.5, −1.5, and 0 at clip seconds 0, 3, 6, and 9, then restores the prior view. Planned and actual camera event times and complete view settings are saved in the manifest. The camera translates along its world Z axis while changing yaw; the scene stays in world coordinates. Normal musical comparison clips keep their fixed view.

Each timestamped folder in `artifacts/visual-tests/` retains WebM recordings, screenshots, diagnostics, audio-clock measurements, test logs, browser errors, and the exact served module with its SHA-256. A run fails if its measured render rate falls below 20 FPS, playback freezes, audio is missing, or the served module changes during recording. Each clip’s measured FPS appears in its manifest and gallery card. Failed attempts remain listed; comparison selectors use completed clips with the same name, start time, and duration (within 0.01 seconds). Refresh the gallery without recording with `npm run test:visual -- --refresh-index`. `node scripts/inspect-recordings.mjs <run-folder>` validates the media and extracts contact sheets.

Capture/test results are separate from visual approval. Add an optional `review.json` beside a run’s manifest, then refresh the index to show the verdict and notes on both its page and the comparison gallery:

```json
{
  "verdict": "Needs revision",
  "observations": ["The drop reads clearly.", "The nodal patterns need more depth."],
  "nextChange": "Make mirrored standing-wave intersections easier to distinguish."
}
```

Unreviewed runs show **Pending review**. Rejected designs remain available for comparison. Existing screenshots and contact sheets link from each clip.

Pause playback when finished reviewing. Build the next module between recording runs, never during a take. Recordings stay local and are excluded from Git.
