# Optional nw_wrld desktop host

The primary app is the actual nw_wrld dashboard and projector adapted for the browser in `app/`: run `npm start` at the repository root. This separate Electron launcher is retained as an optional desktop route. It has a separate Electron runtime and is not required for the browser.

Genome World keeps the existing analyzer and musical conductor and runs its visual voices inside one Three.js scene in nw_wrld. Bass, percussion, harmony, and detail share a camera, depth buffer, lighting, and atmosphere. nw_wrld supplies the desktop dashboard, projector, module lifecycle, hot reload, and MIDI/OSC method routing.

## Run

Requires Node.js 20+, npm, Git, and a desktop capable of running Electron/WebGL.

```sh
npm ci
npm run nw:setup
npm run nw:start
```

`nw:setup` checks out the exact revision in `upstream.json`, applies the tracked patches, installs the upstream lockfile, and builds the host. `nw:start` builds Genome World and opens nw_wrld directly in this project's workspace. First setup needs network access; subsequent launches use the local checkout.

The dashboard opens beside the projector with the **Genome World** track selected. Choose audio in the projector and run analysis, or load an existing genome JSON with its matching audio. Playback and visuals use the same Web Audio clock. The cloud analyzer remains the configured Modal service; existing genome files allow playback without a new analysis request.

The dashboard's four channels invoke play, pause, hide controls, and show controls. External hardware is inactive in the default sequencer mode. To perform with MIDI or OSC, switch out of sequencer mode and select the input in nw_wrld; leaving MIDI unselected stays disconnected. The initial MIDI mapping uses pitch classes C, C♯, D, and D♯ on MIDI channel 1; OSC uses `/ch/1` through `/ch/4`. Its generic sequencer does not run the song clock; use Genome World's transport. Module methods also expose `loadTrack({ audio, genome })`, `seekTrack({ seconds })`, `setFeel({ punch, bass, detail, glow })`, and `setView({ azimuth, elevation, distance })`. Asset arguments are relative to the workspace's `assets/` directory, e.g. `audio/song.wav` and `genomes/song.genome.json`.

```sh
npm run nw:dev       # launch and watch module source; host reloads the rebuilt module
npm run nw:build     # bundle only the workspace module
npm run nw:build:host # rebuild pinned upstream runtime and renderer
npm test
```

## Files and upgrades

- `src/`: Genome World module and shared 3D world.
- `template/`: initial project configuration, copied only when files are missing.
- `project/`: ignored live workspace; dashboard edits and local assets persist here.
- `../scripts/`: reproducible setup, bundle, and launch commands.
- `../.runtime/nw_wrld/`: ignored pinned upstream checkout.
- `../.runtime/profile/`: isolated Electron profile.

Set `NW_WRLD_PROJECT_DIR` or `NW_WRLD_USER_DATA_DIR` to use other locations. Neither setup nor build overwrites an existing workspace's JSON configuration. Build replaces the generated `GenomeWorld.js` module only. Copy the whole `nw/project` folder to preserve a performance setup.

The patches let normal startup select the workspace/profile through environment variables, permit the configured analyzer origin in the sandbox's connect policy, and keep optional MIDI disconnected until selected. Setup fingerprints these patches and rebuilds the host when they change. Other sandbox restrictions remain intact. A different analyzer deployment requires updating the origin in both `patches/analyzer-csp.patch` and `scripts/build-module.mjs` together.

Core Three.js imports resolve to nw_wrld's shared r159 runtime. This avoids multiple Three.js copies and requires world code to stay compatible with that revision. To upgrade, review upstream changes, update the pinned commit and core dependency together, refresh patches, and rebuild in a fresh runtime checkout.

nw_wrld is [GPL-3.0](https://github.com/aagentah/nw_wrld/blob/a660a229d2413c48c3ca03bacf41421ff93e7836/LICENSE). Its source/license remain in the checkout. This integration uses the upstream host; it does not republish it under a different license. Follow the upstream license when distributing a combined build.
