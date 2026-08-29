# genome.json v3 schema

One JSON document per track. Everything is **observed, never imposed**:
no genre rules, no smoothing toward archetypes. Raw probability curves
are kept so ambiguity stays visible to the conductor.

```jsonc
{
  "version": 2,
  "track_sha256": "…",
  "source_filename": "track.m4a",
  "duration": 201.85,

  // ── THE MAP (EDMFormer, MuQ + MusicFM embeddings) ──────────────
  "sections": {
    "hard": [                        // segments, no rule post-processing
      { "label": "buildup", "start": 22.32, "end": 44.28 }
    ],
    "frame_rate": 8.333,
    "labels": ["intro", "buildup", "drop", "breakdown", "outro", "silence"],
    "label_probs": [[0.9, 0.05, …]], // per-frame distribution — ambiguity
    "boundary": [0.01, …]            // per-frame boundary probability
  },

  // ── THE METRONOME (Beat This!, ISMIR 2024) ─────────────────────
  "beats": {
    "bpm": 88.2,                     // may be half/double-time — see roadmap
    "beats": [0.24, …],              // seconds
    "downbeats": [0.24, …],          // bar-1 positions; sections land here
    "onset_phase_offset": -0.05      // measured clock bias vs onsets
  },

  // ── THE NERVES (Rust genome-engine, symphonia decode) ──────────
  "waveform": {                      // ~200fps (5ms hop)
    "frame_rate": 200.0,
    "rms": [], "peak": [], "crest": []
  },
  "bands": {                         // 100fps (10ms hop)
    "frame_rate": 100.0,
    "names": ["sub", "low", "mid", "high", "air"],
    "energy": { "sub": [], "low": [], "mid": [], "high": [], "air": [] },
    "flux":   { "sub": [], "low": [], "mid": [], "high": [], "air": [] },
    "centroid": []                   // Hz, brightness over time
  },
  "onsets": [                        // transient events, attack-stamped
    { "t": 44.36, "strength": 0.82, "band": "low" }
  ],
  "wobble": {                        // bass-band LFO tracker, 2fps
    "frame_rate": 2.0,
    "rate_hz": [],                   // 0 = no periodic modulation
    "depth": []
  },
  "tension": {                       // slow energy+novelty blend, 10fps
    "frame_rate": 10.0,
    "curve": []                      // 0..1, normalized over the track
  },

  // ── THE LAYERS (htdemucs_6s + the Rust engine run on EVERY stem) ──
  // This is what the player binds visual voices to. Which stem plays which
  // role is DISCOVERED per track (see player/src/voices.ts), never named here.
  "stems": {
    "model": "htdemucs_6s",
    "names": ["drums", "bass", "other", "vocals", "guitar", "piano"],
    "rms_frame_rate": 100.0,
    "energy_frame_rate": 50.0,
    "bands": ["sub", "low", "mid", "high", "air"],
    "per_stem": {
      "bass": {
        "rms": [],                   // @ rms_frame_rate
        "energy": { "sub": [], … },  // @ energy_frame_rate
        "centroid": [],              // Hz @ energy_frame_rate
        "onsets": [ { "t": 44.36, "strength": 0.82, "band": "low" } ],
        "wobble": { "frame_rate": 2.0, "rate_hz": [], "depth": [] }
      }
      // … one entry per stem
    }
  },

  "analyzers": ["edmformer", "beat-this", "genome-engine", "htdemucs_6s"]
}
```

## Timing notes for the conductor

- **Sections → downbeats**: section boundaries land within ~0.2s of a
  downbeat. Snap morph completions to the nearest downbeat ≥ boundary.
- **Onsets are attack-stamped** (rising edge, not energy peak) — flash
  visuals AT `t`, no compensation needed.
- **Beats carry `onset_phase_offset`** (~ -0.05s): beat_this positions
  run ~50ms behind physical attack. Add it when mixing beat-grid and
  onset-grid timing.
- **bpm octave**: beat trackers sometimes lock half/double-time on dnb.
  The grid is self-consistent either way; treat `bpm` as advisory.
- **top-level `wobble` is the BASS STEM's LFO** in v3 (it was the mixed
  low band in v2) — the isolated layer is the real modulation.

## Known raw-output quirks (by design)

- Micro-segments (e.g. a 0.36s "intro" at track start) appear because
  rule post-processing is OFF. Consumers should merge segments < ~1s.
- `label_probs` argmax can disagree with `hard` inside long sections —
  that's real ambiguity (tease drops, builds-inside-drops). Use it.
