# Vibify reference review and composition priorities

Reviewed 19 September 2026. Reference: [vibify.club](https://vibify.club). This note records observations and design priorities; it does not report an implemented improvement to AV.

Vibify's most useful lesson for AV is **readable composition**. It gives the eye a recognisable figure, repeat structure, or scene. Greater analytical ambition does not establish that AV's current output is better. The user explicitly rejected the implication that our more ambitious brief makes the current implementation better, and called out Vibify’s focal points. Treat that correction as a design priority. This review inspected Vibify; it did not visually reassess the current AV build.

**Coverage:** all 39 modes exposed by the selector; all 10 palettes; all 10 particle shapes; all 12 visual sliders at 0 and 100 on Lissajous, restoring defaults between controls. Also exercised playback, pause, restart, seek, skip to end, repeat, shuffle, volume, mute, both bundled tracks, local-file loading, panel visibility, section expansion, fullscreen entry, YouTube loading/removal, and Spotify's connection entry point. Feedback was inspected earlier in this conversation. No forms were submitted. Microphone capture and authenticated Spotify playback were not exercised.

The browser was isolated and headless, launched with `--mute-audio`, confirmed in its process arguments. Browser muting preserved the site's audio analysis. The same opening of Floating Signal was restarted for each mode and control sample. Mode screenshots were taken after approximately 3.5 seconds; control screenshots after approximately 1 second. Renderer phase and accumulated particles persist between scene selections, so these are comparable audio excerpts, not identical renderer initial states. This is a breadth survey, not a full-track musical-quality comparison.

**Evidence:** [first 20 modes](../../artifacts/visual-tests/vibify-survey/modes-1.jpg), [remaining 19 modes](../../artifacts/visual-tests/vibify-survey/modes-2.jpg), [palettes](../../artifacts/visual-tests/vibify-survey/palette-contact.jpg), [shapes](../../artifacts/visual-tests/vibify-survey/shape-contact.jpg), [slider extremes](../../artifacts/visual-tests/vibify-survey/param-contact.jpg), [recording](../../artifacts/visual-tests/vibify-survey/survey.webm). `timeline.jsonl` and `controls.jsonl` contain timestamps; `commands.log` records automated interactions. `source-manifest.json` records fetched public assets and their SHA-256 hashes. The demo MP3 and served source are saved beside the recording for reproducibility. These files remain under ignored `artifacts/`. Evidence links resolve only in workspaces retaining that local survey folder; fresh clones will not contain the media or captured third-party source. This document is the durable summary. No public repository or open-source license for Vibify was verified; the references here are observations and design ideas, not reusable licensed assets.

**What to adapt, in order:**

1. **A clear visual hierarchy.** One dominant nodal figure or family, supporting repeated forms, and enough negative space to read them. Focal points can occur throughout a 3D field: nodal crossings, curved wave surfaces, and mirrored convergence regions. The brief's rejection of a central rotating exhibit does not forbid focal points.
2. **Legible form before detail.** A few recognisable modal poses that remain coherent through phrase interiors. Extra particles, bloom, and deformation should strengthen those poses rather than conceal them.
3. **Repetition with structure.** Kaleido and Lissajous demonstrate how repeated elements establish an immediately readable relationship. Rebuild that relationship in world coordinates with real depth; do not copy their screen-space construction.
4. **Layered wave forms.** Helix, Ribbon, Terrain, and Ripple offer useful vocabulary for phase relationships, curvature, and nested contours. In AV, these should emerge from the same 3D nodal field, with different discovered musical voices influencing bounded parts of that field.
5. **Coordinated palettes.** The palette buttons change foreground colours and the background together. Offer a restrained set of complete looks with reliable contrast, including a strong monochrome option. Keep palette transitions on musical boundaries rather than uncontrolled hue cycling.
6. **Understandable controls.** Separate base values from modulation amounts, show the resulting live value, and make zero modulation genuinely off. Separate phrase-scale form controls from drum light and bass flex controls.
7. **A simple performance view.** Hideable controls and a persistent transport are useful. AV should make its 3D world dominant and allow the control panels to disappear.

**Mode inventory and relevance:**

| Mode | Observed composition | Useful lesson for AV |
|---|---|---|
| Blobs | Flat threshold-like dot field | Connected regions; current coarse dots are not a nodal surface |
| Dino | Monochrome runner scene | Clear silhouette and focal action; scene itself unrelated |
| Ink | Small clustered paint-like forms on light ground | Negative space, controlled material contrast |
| Sketch | Doodles and radiating sketch strokes | Line character; too many unrelated motifs for our brief |
| Minecraft | Isometric voxel island | Readable spatial hierarchy; unsuitable scene direction |
| Pokémon | Top-down village scene | Recognisable layout; unsuitable scene direction |
| Invaders | Arcade formation | Ordered repetition; no reason to adopt game imagery |
| Tetris | Blocks within a bordered playfield | Clear figure/ground and grouping |
| Snake | Sparse moving game elements | Sparse focal contrast, not its game motif |
| Cutout | Large flat pale silhouettes | Strong silhouette and visual economy |
| Bubbles | Floating outlined reflective circles | Edge highlights; avoid scattered filler |
| Aquarium | Illustrated fish and plants | Foreground/background hierarchy; unrelated theme |
| Mosaic | Repeating square tile pattern | Repetition and contrast |
| Retro PC | Central illustrated computer/clock | Immediately readable focal object; conflicts with exhibit restriction |
| Fountain | Upward particle spray | Local emission vocabulary, not a foundation |
| Poster | Bold radial/starburst graphics | Strong dominant shape and high contrast |
| Comic | Coloured halftone field | Surface treatment only |
| Op Art | Dense warped stripe field | Particularly useful wave contours and optical interference vocabulary |
| Lava | Coarse merged colour regions | Continuous merging/separation concept; coarse sampled appearance here |
| Stained | Grid of lit geometric cells | Clear local excitation and dark gaps |
| Confetti | Falling coloured fragments | Event accent only; scattered filler is outside the brief |
| Bauhaus | Large simple geometric forms | Shape economy and controlled hierarchy |
| Ribbon | Broad crossing wave strips | Continuous surfaces and layered curvature |
| Kaleido | Repeated mirrored coloured circles | Mirror relationships and repeat count; rebuild in 3D |
| Waveform | Particle traces arranged into synthetic wave paths | Layered contour vocabulary; not a literal sampled waveform |
| Splash | Loose distributed particles | Low relevance to the brief |
| Nebula | Broad circulating particle formation | Grouped density; avoid generic orbiting filler |
| Orbit | Nested elliptical particle paths | Relationships between nested contours |
| Bars | Frequency bars concentrated at the low end | Diagnostic feedback, not the target artwork |
| Stars | Sparse star-like particles | Contrast and restraint only |
| Spiral | Spiral particle paths | A possible pose vocabulary, not an autonomous time-driven effect |
| Tunnel | Perspective-like particle tunnel | Excluded by the brief |
| Grid | Regular reactive particle lattice | Legible ordered structure |
| Lissajous | Intersecting particle curves | Strong shape family; hold frequency ratios across phrases |
| Helix | Paired oscillating strands with cross-connections | Clear phase relationship and layered voices |
| Radial | Circular spectrum strokes | Readable contour and local activation |
| Ripple | Nested expanding particle circles | Nested wavefronts; avoid treating traveling rings as standing waves |
| Vortex | Dense winding particle field | Low relevance; competes with form readability |
| Terrain | Stacked particle ridgelines | Depth layering vocabulary; the implementation is 2D |

The bundle also contains six retro branches not exposed in the visible selector: Cassette, CDPlayer, BoomBox, Discman, Turntable, Speaker. These were identified in source, not independently exercised as UI modes.

**Controls:**

| Control | Behaviour/evidence | Adaptation |
|---|---|---|
| Particle Density | Changes population; generic renderer retains a minimum, with additional audio modulation | Use bounded complexity that preserves the figure |
| Motion Speed | Changes animation advance, with an audio contribution even at base zero | Explicit musical rates and a meaningful hold state |
| Intensity | Changes size/excitation; visually substantial | Keep a bounded articulation control |
| Contrast | Strongly mode-dependent; less obvious on Lissajous than spectral shapes | Name controls by perceptible effect and hide inapplicable ones |
| Responsiveness | Changes audio response gain | Useful sensitivity knob, distinct from topology |
| Glow | Raises luminous contribution; interacts with Trails | Preserve readable edges and highlights |
| Trails | At maximum produces substantial persistence, bright accumulation, and glare | Short, bounded persistence; avoid obscuring nodal structure |
| Hue Shift | Adds cycling hue rotation; default modulation can make base zero nonzero | Phrase-timed palette changes and explicit modulation enable |
| Size Variance | Varies particle sizes | Secondary material detail, not a main control for surfaces |
| Symmetry | Generic renderer makes 1–8 rotated particle copies; Kaleido uses 6–12 sectors with alternate reflection | Actual mirrored 3D field, discrete phrase-held symmetry states |
| Turbulence | Sinusoidal coordinate perturbation | Bounded bass/local flex; avoid independent field-wide wobble |
| Bass Pump | Scales coordinates using low-band energy | Local flex rather than scaling the whole world |

Palettes tested: Deep Violet, Ocean Mist, Sunset Ember, Forest Dew, Neon Pop, Candy, Inferno, Mono Glow, Aurora, Plasma. Shapes tested: Dot, Square, Triangle, Ring, Star, Hexagon, Diamond, Plus, Line, Heart. Shape controls work on the shared particle renderer; bespoke illustrated branches do not uniformly use that renderer, so the same controls should not be assumed meaningful in every mode. Not every mode/parameter cross-product was tested.

**Implementation evidence and limits:** The inspected renderer uses Canvas 2D. Its audio path uses a 1024-point analyser, eight broad frequency groups, smoothed low/mid/high summaries, and a low-energy threshold relative to a short rolling history for beat detection. Its field called `rms` is an average of normalised spectral group magnitudes, not a time-domain RMS measurement. Lissajous ratios respond directly to instantaneous low/high summaries. No stem/phrase scheduling was found in the inspected audio/render path. These observations explain why the rendering vocabulary can be useful while the musical architecture is not the architecture AV needs.

**Input and UI findings:**

- Local demo tracks, selection, transport seeking, volume/mute, and loading the saved public demo as a local file worked. Local-file loading began playback after an asynchronous state update.
- Repeat changed its pressed appearance but playback still stopped at the end. The inspected transport binds Repeat and Shuffle to local UI state without connecting those states to playback behaviour.
- Both side panels can be hidden and restored. The correct restore label is `Show songs panel`; one automation attempt used `Show songs` and failed, then recovered with a fresh snapshot.
- Fullscreen entry was attempted, but `document.fullscreenElement` remained null in this headless run. This is not enough evidence to call fullscreen broken in a normal browser. A subsequent `Exit fullscreen` lookup consequently failed.
- Connect Spotify opens a **waitlist form**, rather than completing a music connection in this public UI. No data was submitted and authenticated playback was not tested.
- YouTube Load resolved the bundled example video's title and exposed Play/Remove controls. Remove worked. The inspected implementation requests tab audio capture; audio-driven YouTube visuals were not verified because no capture permission was granted.
- Feedback opens a name/message form, with no creator or source-repository attribution in the form inspected earlier.
- Microphone UI was inventoried; real microphone capture was not requested or granted.

The practical next design target for AV is **one compelling, readable 3D nodal composition with a dominant figure, controlled repetition, strong dark/light separation, and a small number of unmistakable phrase transitions**. More modes are not the next priority. A judgment that AV currently exceeds Vibify would require recorded comparisons of the actual build, not a comparison of feature lists or intentions.

**Recording limitation:** The encoder blocked on an undrained stderr pipe during the review. Draining that pipe recovered a decodable 164.5-second recording through the final visual-slider test. Later transport/input operations have screenshots and logs, but were not captured in the recovered video. Sampled decoded frames and the ending frame were inspected. Screencast playback timing differs from wall-clock timing, so this video does not establish beat synchronisation or real-time smoothness. The failed stop and encoder log are retained; the isolated headless session is closed.

**Apply this within the existing brief:** The viewport remains a shared three-dimensional scene with standing-wave nodal patterns and kaleidoscopic mirror symmetry evaluated in world coordinates. A focal point is a region of visual emphasis within that scene. It can be a luminous intersection, a dominant curved surface, or repeated areas of convergence at different depths. It does not require a detached central object. Supporting forms belong to the same field and contribute to the dominant composition.

Musical form and articulation remain separate. Phrase summaries of discovered voices determine stable modal poses; bars and section boundaries schedule morphs. Drums articulate light and bass produces bounded local flex. Clear composition must survive those fast events. These are artistic mappings into standing-wave patterns, not claims of calibrated physical cymatics.

**Proposed review criteria for the next visual iteration:**

| Criterion | What to look for in the saved recording |
|---|---|
| Focal hierarchy | The dominant figure and supporting repetition are easy to identify during a phrase. Brightness, scale, and negative space guide attention. |
| Form readability | Nodal contours and mirrored relationships remain legible through bass flex and drum flashes. Added detail strengthens the figure. |
| Depth | Occlusion, perspective, and an intentional parallax check establish that the forms and symmetry occupy world space. |
| Phrase continuity | A pose remains coherent through phrase interiors. Fast events articulate it without rebuilding its topology. |
| Meaningful transitions | Distinct poses and their transitions are visible at the planned bars and section boundaries. A drop is more than a brightness increase. |
| Restraint | Bloom, trails, colour changes, and density preserve separation between forms and space. |
| Honest comparison | Judge actual playback of the same passages. Report observed improvements and failures; analysis features, test passes, and screenshots alone do not establish visual quality. |

Start with one compelling composition and a small set of distinct related poses. Expand visual variety only after their hierarchy, depth, and musical transitions read clearly. Use the existing recording procedure in [README.md](../../README.md#recorded-visual-iterations), retain the baseline and failed candidates, and review the recordings before declaring an improvement. Use or attach to a headed browser only when the user explicitly asks.
