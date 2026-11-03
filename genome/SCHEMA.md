# genome.json v3 schema

One JSON document per track. Everything is **observed, never imposed**:
no genre rules, no smoothing toward archetypes. Raw probability curves
are kept so ambiguity stays visible to the conductor.

```jsonc
{
  "version": 3,
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
  "chroma": {                        // harmony from the mix, 10fps
    "frame_rate": 10.0,
    "pitch_classes": ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],
    "bins": [],                      // rows of 12 values, own max = 1 (or all zero)
    "strength": []                   // tonal clarity x audible presence, 0..1
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
        "wobble": { "frame_rate": 2.0, "rate_hz": [], "depth": [] },
        "chroma": {                  // same shape as top-level, from this stem
          "frame_rate": 10.0,
          "pitch_classes": ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],
          "bins": [], "strength": []
        }
      }
      // … one entry per stem
    }
  },

  "analyzers": ["edmformer", "beat-this", "genome-engine", "htdemucs_6s"]
}
```

## Chroma contract (analyzer 3.1; genome version remains 3)

`genome.chroma` measures the mix; `genome.stems.per_stem.<name>.chroma`
measures that isolated stem without downsampling its 10 fps arrays.
`pitch_classes` fixes the column order, C through B; these are pitch-class
weights, not chord labels or probabilities (rows need not sum to 1).

The engine uses an independent 16384-sample periodic Hann FFT at 44.1 kHz
(371.5 ms, 2.692 Hz bins), with a 4410-sample hop. Only bins with centers in
40–5000 Hz contribute band power or class votes. A bin may vote only when it
is a local magnitude maximum and exceeds the running magnitude median over
±20 bins by more than 6 dB (`magnitude > 10^(6/20) * median`). Neighborhoods
clip at DC/Nyquist; neighbors outside the voting band support this noise-floor
estimate and interpolation but never contribute votes or band power.
Peaks must also have coherent-gain-normalized magnitude at least
`max(frame_peak*10^(-60/20), 1e-6)`, where `frame_peak` is the maximum over
the full positive-frequency spectrum, including frequencies outside the
voting band. The absolute magnitude floor is −120 dBFS; this extra gate
rejects FFT round-off peaks on digitally clean, out-of-band signals.

Each qualifying peak is refined with a parabola through three log-magnitude
bins. With `a=ln(m[k-1])`, `b=ln(m[k])`, `c=ln(m[k+1])`, the sub-bin offset is
`clamp(0.5*(a-c)/(a-2*b+c), -0.5, 0.5)`. Map the resulting frequency `f` to
`round(69 + 12*log2(f/440)) mod 12`, requiring `f` to remain in 40–5000 Hz.
The peak magnitude, normalized by Hann coherent gain, votes for this single
class with `cos²(pi*(midi-round(midi)))`: a fixed ±50-cent taper, including
sub-bass. Interpolation removes the former nearest-bin bass bias.

Divide the raw class sums by their row maximum first, then apply the fixed
compression `ln(1+10*x)/ln(11)` and round to three decimal places. This keeps
the row shape independent of playback level; rows need not sum to 1.

`strength` is rounded to three decimal places and equals clarity × presence:

- For clarity only, normalize the raw class sums by their maximum and floor
  each at `epsilon=1e-3`. Compute `1 - geometric_mean/arithmetical_mean` on
  these floored values, then divide by the pure-single-class value
  `1 - 12*epsilon^(11/12)/(1+11*epsilon)` and clamp to 0–1. A missing class
  now approaches the same finite clarity as a faint class; a pure sine still
  has clarity 1. No qualifying peaks means clarity zero. This regularization
  does not floor or otherwise change the displayed chroma row.
- Band energy is power, including every bin in the band (not just peaks):
  `2*sum(|X|²)/(NFFT*sum(Hann²))`. This is mean-square amplitude corrected
  for Hann power gain. Its reference is `max(p95, 1e-7)`, where p95 is the
  nearest-rank 95th percentile across all frames, including silence. The
  **reference floor is −70 dBFS power**; a sparse chord survives even if p95
  is exactly zero. Use `10*log10(energy/reference)`, then smoothstep on
  `clamp((dB + 40)/34, 0, 1)`: zero at −40 dB relative and one at −6 dB.
- Multiply this relative presence by absolute audibility: smoothstep on
  `clamp((rms_dBFS + 70)/25, 0, 1)`, zero at −70 dBFS and one at −45 dBFS.
  The windowed RMS is `sqrt(sum((sample*Hann)²)/sum(Hann²))`, corrected for
  Hann power gain; `rms_dBFS = 20*log10(RMS)`. Both ramps are zero for
  silence. Absolute audibility prevents faint bleed from self-normalizing
  to full presence. A −40 dBFS **peak** chord can have RMS below −45 dBFS;
  a steady −40 dBFS **RMS** chord is fully audible by this ramp's definition.
- Any frame whose rounded strength is zero has an all-zero row, including
  silence. Otherwise its row maximum is exactly 1.0. JSON numbers may omit
  trailing zeros; precision is three decimal places, not fixed-width text.

## Timing notes for the conductor

- **Chroma is center-aligned**: frame `i` is centered at `i/10` seconds,
  on the same sample clock and zero-based time origin as waveform envelopes
  and per-stem RMS. Envelopes describe blocks starting at `i/frame_rate`;
  chroma places its wider window around that timestamp. Zero-pad beyond both
  file edges; the periodic Hann's peak is exactly at the center sample, so
  there is no half-sample timing offset. Do not add a half-window (185.8 ms)
  offset. There are
  `ceil(sample_count/4410)` rows with matching strength entries; the last
  center is before the decoded duration, even for files shorter than a window.
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
