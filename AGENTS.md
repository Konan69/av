# Working rules

- Use `python3`, never bare `python`.
- Continue safe, authorized work without asking for approval between steps.
- Read `VISION.md` before changing musical or visual behavior. The main app is the actual nw_wrld source in `app/`; the scene lives in `player/src/world/MusicWorld.ts`.
- The visual brief requires **3D cymatic standing-wave nodal patterns and kaleidoscopic mirror symmetry**. Evaluate the nodal field and mirror symmetry in world coordinates so the camera sees depth and perspective. Architectural fins, folded metal, halls, or generic geometric sculptures cannot substitute for this brief.
- Tie nodal modes, morphs, and excitation to discovered musical layers and phrase timing. Describe this as an artistic mapping of music into standing-wave patterns, not a calibrated physical cymatics simulation.
- Build modal poses from summaries of each discovered voice over musical phrases. Hold those poses through phrase interiors; schedule morphs on bars and section boundaries. Fast drum events drive light, and bass drives bounded local flex. Raw frame-by-frame RMS must not rewrite the whole nodal topology. Preserve this separation between musical form and local articulation.
- The whole viewport is a three-dimensional scene. No central rotating exhibit, arbitrary drift or scattered filler.
- the author, 2026-09-30: "why do we have only one thing to focus on … there are no figures no objects no environments … think 3d transformations think 4d too think space time". A scene needs environments, figures and objects together, an ethereal story across the track, and a fast pace (the references change form every 16th note). See `docs/design/spacetime-rebuild-2026-09-30.md`.
- Every visual test and iteration must have a saved recording. Record the existing build before replacing it; record every candidate with `npm run test:visual -- --iteration <descriptive-name>` using the same audio and comparison clips. Keep failed runs too.
- Save audio/video, timestamps, the served module hash/source, diagnostics, errors, and test output together. Test passes and screenshots alone do not establish visual quality. Watch the recordings and compare phrase development and section transitions before calling a visual change complete.
- Recordings live under ignored `artifacts/visual-tests/` and are available in the local app at `/reviews/`. Never commit private audio or generated recordings.
- Use or attach to a headed browser only when the user explicitly asks.
- Keep one projector renderer; pause when not reviewing playback. Do not change the served bundle or restart the host during a recording.
