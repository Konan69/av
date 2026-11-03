# Genome World workspace

This folder is created once from `nw/template`. Dashboard edits persist here.

Use the Genome World projector controls to choose a track and analyze it, or load existing audio plus genome JSON. The dashboard's channels map to play (1), pause (2), hide controls (3), and show controls (4).

Put reusable audio in `assets/audio/` and analysis JSON in `assets/genomes/`. The module's `loadTrack` method accepts those relative asset paths. Source lives in `nw/src`, not the generated `modules/GenomeWorld.js`. Run `npm run nw:dev` at the repository root to rebuild and reload source edits.
