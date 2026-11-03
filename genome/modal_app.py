"""Genome Analyzer v3 — Modal deployment.

One upload -> one genome.json containing everything the AV engine needs:

  sections   EDMFormer (25ohms/EDM-98) — hard segments + RAW per-frame
             label probabilities + boundary curve (observe, don't impose:
             no rule-based post-processing)
  beats      Beat This! (CPJKU, ISMIR 2024) — neural beat + downbeat grid
  waveform   Rust engine — rms/peak/crest envelopes @200fps
  bands      Rust engine — 5-band energy + spectral flux @100fps, centroid
  chroma     Rust engine — 12 pitch classes + tonal presence @10fps
  onsets     Rust engine — transient events, ms-precise, band-attributed
  wobble     Rust engine — bass LFO rate + depth (2fps)
  tension    Rust engine — slow energy/novelty curve (10fps)
  stems      HTDemucs 6-stem separation (drums/bass/other/vocals/guitar/
             piano) + the Rust engine run on EVERY stem, so each discovered
             layer carries its own rms / band energy / onsets / wobble.
             The player binds visual voices to these, not to hand-picked
             frequency bands.

Weights live on a persistent Modal Volume (downloaded once, ever).

Usage:
  modal run modal_app.py::download_weights   # one-time weight fetch
  modal deploy modal_app.py                  # deploy the endpoint
"""

# pyright: reportMissingImports=false
# Deps (modal/torch/edm98/beat_this/librosa) intentionally live in the
# Modal image, not the local venv — nothing heavyweight installs locally.

import hashlib
import json

import modal

app = modal.App("genome-analyzer")

weights = modal.Volume.from_name("genome-weights", create_if_missing=True)

WEIGHTS_DIR = "/weights"
CKPT_DIR = f"{WEIGHTS_DIR}/checkpoints"
HF_CACHE_DIR = f"{WEIGHTS_DIR}/hf"
GENOMES_DIR = f"{WEIGHTS_DIR}/genomes"

MODEL_PT_URL = "https://github.com/25ohms/EDM-98/raw/main/data/checkpoints/model.pt"
MUSICFM_PT_URL = "https://huggingface.co/minzwon/MusicFM/resolve/main/pretrained_msd.pt"
MSD_STATS_URL = "https://raw.githubusercontent.com/25ohms/EDM-98/main/data/checkpoints/msd_stats.json"
MUQ_REPO = "OpenMuQ/MuQ-large-msd-iter"
EDM98_COMMIT = "2dd942f2f9e71ffd826346828eeaba1dd3ece56a"

HERE = __file__.rsplit("/", 1)[0]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "git", "curl", "build-essential")
    .pip_install(
        "torch>=2.4.0",
        f"edm98[inference] @ git+https://github.com/25ohms/EDM-98.git@{EDM98_COMMIT}",
        "muq @ git+https://github.com/tencent-ailab/MuQ.git",
        "beat_this @ git+https://github.com/CPJKU/beat_this",
        "demucs==4.0.1",
        # MuQ passes an EasyDict as the model config; transformers >=4.50's
        # masking_utils expects a real PretrainedConfig (._attn_implementation).
        # Adding demucs floated this dep, so it is pinned explicitly.
        "transformers==4.44.2",
        "soundfile",
        "fastapi[standard]",
        "python-multipart",
        "huggingface_hub",
    )
    .run_commands(
        "git clone --depth 1 https://github.com/minzwon/musicfm.git /opt/musicfm",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
    )
    .env({"MUSICFMPATH": "/opt/musicfm"})
    .add_local_file(f"{HERE}/configs/edmformer.yaml", "/opt/edmformer.yaml", copy=True)
    .add_local_file(f"{HERE}/engine/Cargo.toml", "/opt/engine/Cargo.toml", copy=True)
    .add_local_file(f"{HERE}/engine/Cargo.lock", "/opt/engine/Cargo.lock", copy=True)
    .add_local_file(f"{HERE}/engine/src/main.rs", "/opt/engine/src/main.rs", copy=True)
    .run_commands(
        "cd /opt/engine && /root/.cargo/bin/cargo build --release --locked"
        " && cp target/release/genome-engine /usr/local/bin/genome-engine"
        " && rm -rf target /root/.cargo/registry"
    )
)

from fastapi import File, HTTPException, Request, UploadFile  # noqa: F401,E402

with image.imports():
    import torch  # noqa: F401
    from edm98.inference.pipeline import InferencePipeline

# bump when the pipeline changes so cached genomes regenerate
ANALYZER_VERSION = "3.1"

# canonical label order for probability curves (ids from edm98.inference.labels)
SECTION_LABELS = ["intro", "buildup", "drop", "breakdown", "outro", "silence"]
SECTION_LABEL_IDS = [0, 69, 70, 36, 5, 6]


def _predict_with_curves(pipeline, audio_path: str) -> dict:
    """EDMFormer inference that keeps the RAW per-frame curves.

    Adapted from edm98.inference.pipeline.InferencePipeline.predict_file
    (25ohms/EDM-98, CC-BY-4.0). Same model, same math — but returns the
    per-frame boundary probabilities and label distributions alongside
    the hard segments, and skips the rule-based post-processing.
    """
    import math

    import numpy as np
    import torch
    from edm98.inference.pipeline import (
        AFTER_DOWNSAMPLING_FRAME_RATES,
        INPUT_SAMPLING_RATE,
        TIME_DUR,
        _load_audio_backend,
    )
    from edm98.inference.postprocess import postprocess_functional_structure

    librosa = _load_audio_backend()
    wav, _ = librosa.load(audio_path, sr=INPUT_SAMPLING_RATE)
    audio = torch.tensor(wav).to(pipeline.device)

    total_len = ((audio.shape[0] // INPUT_SAMPLING_RATE) // TIME_DUR * TIME_DUR) + TIME_DUR
    total_frames = math.ceil(total_len * AFTER_DOWNSAMPLING_FRAME_RATES)

    logits = {
        "function_logits": np.zeros([total_frames, pipeline.config.num_classes]),
        "boundary_logits": np.zeros([total_frames]),
    }
    logits_num = {
        "function_logits": np.zeros([total_frames, pipeline.config.num_classes]),
        "boundary_logits": np.zeros([total_frames]),
    }

    lens = 0
    i = 0
    with torch.no_grad():
        while True:
            start_idx = i * INPUT_SAMPLING_RATE
            end_idx = min((i + TIME_DUR) * INPUT_SAMPLING_RATE, audio.shape[-1])
            if start_idx >= audio.shape[-1] or end_idx - start_idx <= 1024:
                break

            wrapped_muq_30s, muq_420s = pipeline._extract_muq_block(audio, i)
            wrapped_mfm_30s, mfm_420s = pipeline._extract_musicfm_block(audio, i)

            all_embds = [wrapped_mfm_30s, wrapped_muq_30s, mfm_420s, muq_420s]
            min_len = min(x.shape[1] for x in all_embds)
            all_embds = [x[:, :min_len, :].to(pipeline.device) for x in all_embds]
            embd = torch.concatenate(all_embds, axis=-1)

            _info, chunk_logits = pipeline.model.infer(
                input_embeddings=embd,
                dataset_ids=pipeline.dataset_ids,
                label_id_masks=pipeline.label_mask,
                with_logits=True,
            )

            start_frame = int(i * AFTER_DOWNSAMPLING_FRAME_RATES)
            end_frame = start_frame + min(
                math.ceil(TIME_DUR * AFTER_DOWNSAMPLING_FRAME_RATES),
                chunk_logits["boundary_logits"][0].shape[0],
            )
            logits["function_logits"][start_frame:end_frame, :] += (
                chunk_logits["function_logits"][0].detach().cpu().numpy()
            )
            logits["boundary_logits"][start_frame:end_frame] = (
                chunk_logits["boundary_logits"][0].detach().cpu().numpy()
            )
            logits_num["function_logits"][start_frame:end_frame, :] += 1
            logits_num["boundary_logits"][start_frame:end_frame] += 1
            lens += end_frame - start_frame
            del embd, chunk_logits
            i += TIME_DUR

    logits["function_logits"] /= logits_num["function_logits"]
    logits["boundary_logits"] /= logits_num["boundary_logits"]
    fn = torch.from_numpy(logits["function_logits"][:lens]).unsqueeze(0)
    bd = torch.from_numpy(logits["boundary_logits"][:lens]).unsqueeze(0)

    # hard segments WITHOUT rule post-processing — observed, not imposed
    msa = postprocess_functional_structure({"function_logits": fn, "boundary_logits": bd}, pipeline.config)
    segments = [
        {"label": msa[idx][1], "start": float(msa[idx][0]), "end": float(msa[idx + 1][0])}
        for idx in range(len(msa) - 1)
    ]

    # raw curves: boundary probability + 6-class label distribution per frame
    boundary = torch.sigmoid(bd[0]).numpy()
    sel = fn[0][:, SECTION_LABEL_IDS]  # [T, 6]
    probs = torch.softmax(sel, dim=-1).numpy()

    return {
        "hard": segments,
        "frame_rate": AFTER_DOWNSAMPLING_FRAME_RATES,
        "labels": SECTION_LABELS,
        "label_probs": np.round(probs, 4).tolist(),
        "boundary": np.round(boundary, 4).tolist(),
    }


def _beats(audio_path: str, device: str) -> dict | None:
    """Beat This! neural beat + downbeat tracking. None on any failure."""
    try:
        import numpy as np
        from beat_this.inference import File2Beats

        f2b = File2Beats(checkpoint_path="final0", device=device, dbn=False)
        beats, downbeats = f2b(audio_path)
        beats = np.round(np.asarray(beats, dtype=float), 3).tolist()
        downbeats = np.round(np.asarray(downbeats, dtype=float), 3).tolist()
        bpm = None
        if len(beats) > 2:
            intervals = np.diff(beats)
            bpm = round(float(60.0 / np.median(intervals)), 1)
        return {"bpm": bpm, "beats": beats, "downbeats": downbeats}
    except Exception as exc:  # never block the genome on the beat grid
        return {"bpm": None, "beats": [], "downbeats": [], "error": str(exc)}


def _rust_engine(audio_path: str) -> tuple[dict, str]:
    """Run the genome-engine binary on ANY audio file (it decodes via
    symphonia, resamples to 44.1k, and emits a WAV for beat_this)."""
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav_path = f.name
    json_path = wav_path + ".json"
    try:
        subprocess.run(
            ["genome-engine", audio_path, json_path, wav_path],
            check=True,
            capture_output=True,
            text=True,
        )
        with open(json_path) as f:
            return json.load(f), wav_path
    finally:
        import os

        if os.path.exists(json_path):
            os.unlink(json_path)


STEM_MODEL = "htdemucs_6s"


def _stems(wav_path: str, device: str) -> dict:
    """6-stem separation + per-stem genome-engine analysis.

    Returns {names, frame rates, per-stem {rms@100fps, energy@50fps,
    centroid@50fps, onsets, wobble, chroma@10fps}}. Every number here is
    OBSERVED from the separated layer — this lets the player give each layer of
    the track its own body instead of slicing the mix into fixed bands.
    """
    import os
    import subprocess
    import tempfile

    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model(STEM_MODEL)
    model.to(device)
    model.eval()

    audio, sr = sf.read(wav_path, dtype="float32", always_2d=True)  # [T, C]
    if sr != model.samplerate:
        raise RuntimeError(f"stem input must be {model.samplerate} Hz, got {sr}")
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    mix = torch.from_numpy(audio.T).unsqueeze(0).to(device)  # [1, 2, T]
    ref = mix.mean(0)
    mix = (mix - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        out = apply_model(model, mix, device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()  # [S, 2, T]

    names = list(model.sources)
    stems: dict = {}
    tmpdir = tempfile.mkdtemp()
    try:
        for i, name in enumerate(names):
            mono = out[i].mean(0).clamp(-1, 1).cpu().numpy()
            stem_wav = f"{tmpdir}/{name}.wav"
            stem_json = f"{tmpdir}/{name}.json"
            sf.write(stem_wav, mono, sr, subtype="FLOAT")
            subprocess.run(
                ["genome-engine", stem_wav, stem_json],
                check=True,
                capture_output=True,
                text=True,
            )
            with open(stem_json) as f:
                r = json.load(f)
            env = r["envelopes"]
            bands = r["bands"]
            stems[name] = {
                "rms": env["rms"][::2],  # 200 -> 100 fps
                "energy": {b: v[::2] for b, v in bands["energy"].items()},  # 100 -> 50 fps
                "centroid": bands["centroid"][::2],
                "onsets": r["onsets"],
                "wobble": r["wobble"],
                "chroma": r["chroma"],
            }
    finally:
        import shutil

        shutil.rmtree(tmpdir, ignore_errors=True)
    del out, mix
    torch.cuda.empty_cache()
    return {
        "model": STEM_MODEL,
        "names": names,
        "rms_frame_rate": 100.0,
        "energy_frame_rate": 50.0,
        "bands": list(stems[names[0]]["energy"].keys()),
        "per_stem": stems,
    }


# Runtime-only env: pointing these at the volume at IMAGE level makes
# build-time imports create dirs under /weights, breaking the volume mount.
RUNTIME_ENV = {
    "TORCH_HOME": f"{WEIGHTS_DIR}/cache/torch",
    "XDG_CACHE_HOME": f"{WEIGHTS_DIR}/cache",
}


@app.function(image=image, volumes={WEIGHTS_DIR: weights}, env=RUNTIME_ENV, timeout=3600)
def download_weights():
    """One-time: fetch all model weights into the persistent volume."""
    import os
    import subprocess

    os.makedirs(CKPT_DIR, exist_ok=True)

    def fetch(url: str, dest: str, min_bytes: int = 1_000_000):
        if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes:
            print(f"already present: {dest} ({os.path.getsize(dest)} bytes)")
            return
        print(f"downloading {url} -> {dest}")
        subprocess.run(["curl", "-fL", "--retry", "3", "-o", dest, url], check=True)
        print(f"done: {dest} ({os.path.getsize(dest)} bytes)")

    fetch(MODEL_PT_URL, f"{CKPT_DIR}/model.pt")
    fetch(MUSICFM_PT_URL, f"{CKPT_DIR}/pretrained_msd.pt")
    fetch(MSD_STATS_URL, f"{CKPT_DIR}/msd_stats.json", min_bytes=100)

    print(f"downloading MuQ snapshot: {MUQ_REPO}")
    os.environ["HF_HOME"] = HF_CACHE_DIR
    from huggingface_hub import snapshot_download

    path = snapshot_download(MUQ_REPO)
    print(f"MuQ cached at: {path}")

    # warm the Beat This! checkpoint into the volume-backed cache
    try:
        from beat_this.inference import File2Beats

        File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
        print("beat-this checkpoint cached")
    except Exception as exc:
        print(f"WARNING: beat-this warmup failed (will retry at runtime): {exc}")

    try:
        from demucs.pretrained import get_model

        get_model(STEM_MODEL)
        print(f"{STEM_MODEL} weights cached")
    except Exception as exc:
        print(f"WARNING: demucs warmup failed (will retry at runtime): {exc}")

    weights.commit()
    print("all weights committed to volume")


@app.cls(
    image=image,
    gpu="T4",
    volumes={WEIGHTS_DIR: weights},
    env=RUNTIME_ENV,
    memory=16384,
    scaledown_window=300,
    timeout=1800,
)
class Analyzer:
    """Warm container: models loaded once on enter, reused across calls."""

    @modal.enter()
    def load_models(self):
        self.pipeline = InferencePipeline(
            checkpoint_path=f"{CKPT_DIR}/model.pt",
            config_path="/opt/edmformer.yaml",
            musicfm_stat_path=f"{CKPT_DIR}/msd_stats.json",
            musicfm_model_path=f"{CKPT_DIR}/pretrained_msd.pt",
            hf_cache_dir=HF_CACHE_DIR,
            device="cuda",
            persistent_models=True,
        )

    def _run(self, audio_bytes: bytes, filename: str) -> dict:
        import os
        import pathlib
        import tempfile

        digest = hashlib.sha256(audio_bytes).hexdigest()
        os.makedirs(GENOMES_DIR, exist_ok=True)
        cache_path = f"{GENOMES_DIR}/{digest}.{ANALYZER_VERSION}.genome.json"

        try:
            weights.reload()
        except Exception:
            pass  # open HF xet logs can block reload; cache check is best-effort
        if os.path.exists(cache_path):
            with open(cache_path) as f:
                cached = json.load(f)
            cached["cached"] = True
            return cached

        suffix = pathlib.Path(filename).suffix or ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            rust, wav_path = _rust_engine(tmp_path)
            try:
                # every model reads the SAME symphonia-decoded 44.1k wav, so
                # format support is the Rust decoder's job alone (librosa's
                # soundfile backend cannot open m4a/aac).
                sections = _predict_with_curves(self.pipeline, wav_path)
                beats = _beats(wav_path, str(self.pipeline.device))
                # measure the clock bias between the two analyzers (beat_this
                # outputs center-aligned positions, ~50ms behind physical
                # attack). Observed per track, so the conductor can align.
                if beats and beats.get("beats") and rust.get("onsets"):
                    import statistics

                    onset_ts = [o["t"] for o in rust["onsets"]]
                    diffs = [
                        min(onset_ts, key=lambda o: abs(o - b)) - b
                        for b in beats["beats"][:300]
                    ]
                    beats["onset_phase_offset"] = (
                        round(statistics.median(diffs), 4) if diffs else 0.0
                    )
                stems = _stems(wav_path, str(self.pipeline.device))
            finally:
                os.unlink(wav_path)
        finally:
            os.unlink(tmp_path)

        # the wobble that matters is the BASS LAYER's LFO, not the mix's
        wobble = stems["per_stem"]["bass"]["wobble"] if "bass" in stems["per_stem"] else rust["wobble"]

        result = {
            "version": 3,
            "track_sha256": digest,
            "source_filename": filename,
            "duration": rust["duration"],
            "sections": sections,
            "beats": beats,
            "waveform": rust["envelopes"],
            "bands": rust["bands"],
            "chroma": rust["chroma"],
            "onsets": rust["onsets"],
            "wobble": wobble,
            "tension": rust["tension"],
            "stems": stems,
            "analyzers": ["edmformer", "beat-this", "genome-engine", STEM_MODEL],
            "cached": False,
        }
        with open(cache_path, "w") as f:
            json.dump(result, f)
        weights.commit()
        return result

    @modal.method()
    def analyze(self, audio_bytes: bytes, filename: str) -> dict:
        return self._run(audio_bytes, filename)

    @modal.asgi_app()
    def web(self):
        """Browser-facing API (CORS open so the player can call it directly).

        POST /analyze  multipart `file` -> genome.json v3 (cached by sha256)
        GET  /health
        If GENOME_API_KEY is set (Modal secret), callers must send `x-api-key`.
        """
        import os

        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        api = FastAPI()
        api.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        analyzer = self

        @api.post("/analyze")
        async def analyze(request: Request, file: UploadFile = File(...)) -> dict:
            expected = os.environ.get("GENOME_API_KEY")
            if expected and request.headers.get("x-api-key") != expected:
                raise HTTPException(status_code=401, detail="invalid api key")
            audio = await file.read()
            if not audio:
                raise HTTPException(status_code=400, detail="empty file")
            return analyzer._run(audio, file.filename or "upload.wav")

        @api.get("/health")
        def health() -> dict:
            return {
                "ok": True,
                "version": 3,
                "analyzer_version": ANALYZER_VERSION,
                "analyzers": ["edmformer", "beat-this", "genome-engine", STEM_MODEL],
                "labels": SECTION_LABELS,
            }

        return api
