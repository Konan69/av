//! Genome waveform engine — observes a track's physical signals.
//! Nothing here assumes genre, tempo, or structure. It measures:
//!   - waveform envelopes (rms / peak / crest)        ~200fps
//!   - multi-band energy + spectral flux              ~100fps
//!   - onsets (transient events, per-band attributed) ms-precise
//!   - bass-band LFO (wobble) rate + depth            2fps
//!   - tension curve (slow energy + novelty)          10fps
//!
//! Usage: genome-engine <input.wav> <output.json>

use anyhow::{Context, Result};
use hound::WavReader;
use rustfft::{num_complex::Complex32, FftPlanner};
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::io::BufWriter;

const BANDS: [(&str, f32, f32); 5] = [
    ("sub", 20.0, 60.0),
    ("low", 60.0, 250.0),
    ("mid", 250.0, 2000.0),
    ("high", 2000.0, 8000.0),
    ("air", 8000.0, 16000.0),
];

#[derive(Serialize)]
struct Onset {
    t: f32,
    strength: f32,
    band: &'static str,
}

#[derive(Serialize)]
struct Envelopes {
    frame_rate: f32,
    rms: Vec<f32>,
    peak: Vec<f32>,
    crest: Vec<f32>,
}

#[derive(Serialize)]
struct Bands {
    frame_rate: f32,
    names: Vec<&'static str>,
    energy: HashMap<&'static str, Vec<f32>>,
    flux: HashMap<&'static str, Vec<f32>>,
    centroid: Vec<f32>,
}

#[derive(Serialize)]
struct Wobble {
    frame_rate: f32,
    rate_hz: Vec<f32>,
    depth: Vec<f32>,
}

#[derive(Serialize)]
struct Tension {
    frame_rate: f32,
    curve: Vec<f32>,
}

#[derive(Serialize)]
struct Output {
    sample_rate: u32,
    duration: f32,
    envelopes: Envelopes,
    bands: Bands,
    onsets: Vec<Onset>,
    wobble: Wobble,
    tension: Tension,
}

fn r4(x: f32) -> f32 {
    (x * 10000.0).round() / 10000.0
}

fn read_wav(path: &str) -> Result<(Vec<f32>, u32)> {
    let mut reader = WavReader::open(path).with_context(|| format!("open {path}"))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;
    let raw: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Float, _) => reader
            .samples::<f32>()
            .collect::<hound::Result<Vec<_>>>()?,
        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
            .collect::<hound::Result<Vec<_>>>()?,
        (hound::SampleFormat::Int, _) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / i32::MAX as f32))
            .collect::<hound::Result<Vec<_>>>()?,
    };
    let mono: Vec<f32> = if channels > 1 {
        raw.chunks_exact(channels)
            .map(|c| c.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        raw
    };
    Ok((mono, spec.sample_rate))
}

/// Decode ANY audio format (m4a/aac, mp3, flac, ogg, wav...) via symphonia.
fn decode_any(path: &str) -> Result<(Vec<f32>, u32)> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = File::open(path).with_context(|| format!("open {path}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    let track = format.default_track().context("no default audio track")?;
    let track_id = track.id;
    let sr = track
        .codec_params
        .sample_rate
        .context("unknown sample rate")?;
    let mut decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;

    let mut interleaved: Vec<f32> = Vec::new();
    let mut channels = 1usize;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break, // EOF or stream end
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue, // skip undecodable packets
        };
        channels = decoded.spec().channels.count().max(1);
        let mut sbuf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        sbuf.copy_interleaved_ref(decoded);
        interleaved.extend_from_slice(sbuf.samples());
    }
    if interleaved.is_empty() {
        anyhow::bail!("no decodable audio in {path}");
    }
    let mono: Vec<f32> = if channels > 1 {
        interleaved
            .chunks_exact(channels)
            .map(|c| c.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        interleaved
    };
    Ok((mono, sr))
}

/// Linear-interpolation resampler. Plenty for envelope/spectral analysis.
fn resample_linear(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos.floor() as usize;
            let frac = (pos - i0 as f64) as f32;
            let a = samples[i0.min(samples.len() - 1)];
            let b = samples[(i0 + 1).min(samples.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

fn write_wav44(path: &str, samples: &[f32]) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 44100,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &s in samples {
        writer.write_sample(s)?;
    }
    writer.finalize()?;
    Ok(())
}

fn load_audio(path: &str) -> Result<(Vec<f32>, u32)> {
    let is_wav = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);
    if is_wav {
        read_wav(path).or_else(|_| decode_any(path))
    } else {
        decode_any(path)
    }
}

/// rms / peak / crest envelopes at a fixed hop
fn envelopes(samples: &[f32], sr: u32) -> Envelopes {
    let hop = (sr as f32 * 0.005) as usize; // 5ms
    let mut rms = Vec::new();
    let mut peak = Vec::new();
    let mut crest = Vec::new();
    for frame in samples.chunks_exact(hop) {
        let mut sum_sq = 0.0f32;
        let mut pk = 0.0f32;
        for &s in frame {
            sum_sq += s * s;
            pk = pk.max(s.abs());
        }
        let r = (sum_sq / hop as f32).sqrt();
        rms.push(r4(r));
        peak.push(r4(pk));
        crest.push(r4(pk / (r + 1e-8)));
    }
    Envelopes {
        frame_rate: sr as f32 / hop as f32,
        rms,
        peak,
        crest,
    }
}

struct Spectral {
    band_energy: HashMap<&'static str, Vec<f32>>,
    band_flux: HashMap<&'static str, Vec<f32>>,
    total_flux: Vec<f32>,
    centroid: Vec<f32>,
    low_energy: Vec<f32>, // sub+low, for wobble tracking
    broadband: Vec<f32>,  // all-band sum, for tension
    frame_rate: f32,
}

/// STFT -> per-band energy, SuperFlux-style spectral flux, centroid.
/// Streaming: keeps only the previous frame's log-magnitudes.
fn spectral(samples: &[f32], sr: u32) -> Spectral {
    const NFFT: usize = 2048;
    let hop = (sr as usize) / 100; // 10ms
    let bins = NFFT / 2 + 1;
    let bin_hz = sr as f32 / NFFT as f32;

    let band_bins: Vec<(&'static str, usize, usize)> = BANDS
        .iter()
        .map(|(name, lo, hi)| {
            let b0 = ((*lo / bin_hz) as usize).min(bins - 1);
            let b1 = (((*hi / bin_hz) as usize) + 1).min(bins);
            (*name, b0, b1.max(b0 + 1))
        })
        .collect();

    let hann: Vec<f32> = (0..NFFT)
        .map(|i| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (NFFT - 1) as f32).cos()))
        .collect();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(NFFT);

    let mut band_energy: HashMap<&'static str, Vec<f32>> =
        band_bins.iter().map(|(n, _, _)| (*n, Vec::new())).collect();
    let mut band_flux: HashMap<&'static str, Vec<f32>> =
        band_bins.iter().map(|(n, _, _)| (*n, Vec::new())).collect();
    let mut total_flux = Vec::new();
    let mut centroid = Vec::new();
    let mut low_energy = Vec::new();
    let mut broadband = Vec::new();

    let mut prev_log: Option<Vec<f32>> = None;
    let mut buf = vec![Complex32::new(0.0, 0.0); NFFT];

    for (fi, frame) in samples.windows(NFFT).step_by(hop).enumerate() {
        let _ = fi;
        for (i, &s) in frame.iter().enumerate() {
            buf[i] = Complex32::new(s * hann[i], 0.0);
        }
        fft.process(&mut buf);

        // log-magnitude spectrum
        let log_mag: Vec<f32> = buf[..bins].iter().map(|c| (1.0 + c.norm()).ln()).collect();

        // band energies (linear-domain sum, then log-compressed)
        let mut low_sum = 0.0f32;
        let mut broad_sum = 0.0f32;
        for (name, b0, b1) in &band_bins {
            let lin: f32 = buf[*b0..*b1].iter().map(|c| c.norm()).sum();
            band_energy.get_mut(name).unwrap().push(r4((1.0 + lin).ln()));
            if *name == "sub" || *name == "low" {
                low_sum += lin;
            }
            broad_sum += lin;
        }
        low_energy.push((1.0 + low_sum).ln());
        broadband.push((1.0 + broad_sum).ln());

        // spectral centroid
        let (mut num, mut den) = (0.0f32, 0.0f32);
        for (f, c) in buf[..bins].iter().enumerate() {
            let m = c.norm();
            num += f as f32 * bin_hz * m;
            den += m;
        }
        centroid.push(r4(if den > 1e-8 { num / den } else { 0.0 }));

        // SuperFlux-lite: positive diff vs freq-max-filtered previous frame
        if let Some(prev) = &prev_log {
            let mut flux_per_band: HashMap<&'static str, f32> =
                band_bins.iter().map(|(n, _, _)| (*n, 0.0)).collect();
            let mut tot = 0.0f32;
            for f in 0..bins {
                let lo = f.saturating_sub(1);
                let hi = (f + 2).min(bins);
                let ref_v = prev[lo..hi].iter().cloned().fold(f32::MIN, f32::max);
                let d = (log_mag[f] - ref_v).max(0.0);
                tot += d;
                for (name, b0, b1) in &band_bins {
                    if f >= *b0 && f < *b1 {
                        *flux_per_band.get_mut(name).unwrap() += d;
                    }
                }
            }
            for (name, v) in flux_per_band {
                band_flux.get_mut(name).unwrap().push(r4(v));
            }
            total_flux.push(r4(tot));
        }
        prev_log = Some(log_mag);
    }

    Spectral {
        band_energy,
        band_flux,
        total_flux,
        centroid,
        low_energy,
        broadband,
        frame_rate: sr as f32 / hop as f32,
    }
}

/// Adaptive-threshold peak picking on the total flux curve.
fn onsets(spec: &Spectral) -> Vec<Onset> {
    let flux = &spec.total_flux;
    let n = flux.len();
    if n < 4 {
        return Vec::new();
    }
    let max_flux = flux.iter().cloned().fold(0.0f32, f32::max);
    let win = (0.5 * spec.frame_rate) as usize; // 0.5s adaptive window
    let min_gap = (0.03 * spec.frame_rate) as usize; // 30ms

    let names: Vec<&'static str> = BANDS.iter().map(|(n, _, _)| *n).collect();
    let mut out = Vec::new();
    let mut last = 0usize;
    let mut first = true;

    for t in 1..n - 1 {
        if flux[t] < flux[t - 1] || flux[t] < flux[t + 1] {
            continue; // not a local max
        }
        let lo = t.saturating_sub(win);
        let mut w: Vec<f32> = flux[lo..t].to_vec();
        w.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let med = if w.is_empty() { 0.0 } else { w[w.len() / 2] };
        let thresh = med * 1.5 + 0.01 * max_flux;
        let gap_ok = first || t - last >= min_gap;
        if flux[t] > thresh && gap_ok {
            // dominant band = highest PER-BIN average flux (raw sums would
            // always favor wide bands: air spans ~200x more bins than sub)
            let (band, _) = names
                .iter()
                .map(|n| {
                    let v = spec
                        .band_flux
                        .get(n)
                        .and_then(|f| f.get(t - 1)) // flux vec is 1 shorter (diff)
                        .cloned()
                        .unwrap_or(0.0);
                    let width = BANDS
                        .iter()
                        .find(|(bn, _, _)| bn == n)
                        .map(|(_, lo, hi)| hi - lo)
                        .unwrap_or(1.0);
                    (*n, v / width)
                })
                .fold(("mid", 0.0f32), |best, cur| if cur.1 > best.1 { cur } else { best });
            // timestamp the ATTACK START, not the flux peak: walk back from
            // the peak to the last frame under 25% of peak strength. The
            // perceived hit starts at the rising edge (~40ms before peak).
            let mut attack = t;
            let floor = 0.25 * flux[t];
            while attack > 0 && flux[attack - 1] > floor && t - attack < 20 {
                attack -= 1;
            }
            out.push(Onset {
                t: r4(attack as f32 / spec.frame_rate),
                strength: r4(flux[t] / (max_flux + 1e-8)),
                band,
            });
            last = t;
            first = false;
        }
    }
    out
}

/// LFO tracker on the sub+low band: autocorrelation of the 100fps energy
/// envelope in sliding windows. Reports modulation rate (0.5..20Hz) and depth.
fn wobble(spec: &Spectral) -> Wobble {
    let env = &spec.low_energy;
    let fps = spec.frame_rate;
    let win = (4.0 * fps) as usize; // 4s window
    let hop = (0.5 * fps) as usize; // 0.5s hop -> 2fps output
    let out_fps = fps / hop as f32;

    let mut rate_hz = Vec::new();
    let mut depth = Vec::new();

    if env.len() < win {
        return Wobble { frame_rate: out_fps, rate_hz, depth };
    }

    let min_lag = (fps / 20.0) as usize; // 20 Hz max LFO
    let max_lag = (fps / 0.5) as usize; // 0.5 Hz min LFO

    for w in env.windows(win).step_by(hop) {
        let mean = w.iter().sum::<f32>() / win as f32;
        let detr: Vec<f32> = w.iter().map(|&v| v - mean).collect();
        let e0: f32 = detr.iter().map(|v| v * v).sum::<f32>() + 1e-8;

        let (mut best_lag, mut best_corr) = (0usize, 0.0f32);
        for lag in min_lag..=max_lag.min(win - 1) {
            let mut acc = 0.0f32;
            for i in 0..win - lag {
                acc += detr[i] * detr[i + lag];
            }
            let c = acc / e0;
            if c > best_corr {
                best_corr = c;
                best_lag = lag;
            }
        }
        let at_edge = best_lag <= min_lag || best_lag >= max_lag.min(win - 1);
        let rate = if best_corr > 0.35 && best_lag > 0 && !at_edge {
            fps / best_lag as f32
        } else {
            0.0 // boundary-pinned lag = autocorr edge artifact, not music
        };
        rate_hz.push(r4(rate));

        // depth: p90-p10 relative to mean
        let mut sorted = w.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p10 = sorted[(win as f32 * 0.1) as usize];
        let p90 = sorted[((win as f32 * 0.9) as usize).min(win - 1)];
        depth.push(r4((p90 - p10) / (mean + 1e-8)));
    }

    Wobble { frame_rate: r4(out_fps), rate_hz, depth }
}

/// Slow tension curve: smoothed broadband energy blended with novelty
/// (smoothed flux), min-max normalized over the track, 10fps.
fn tension(spec: &Spectral) -> Tension {
    let fps = spec.frame_rate;
    let smooth = (1.0 * fps) as usize; // 1s moving average

    let mov_avg = |v: &[f32]| -> Vec<f32> {
        v.windows(smooth)
            .map(|w| w.iter().sum::<f32>() / smooth as f32)
            .collect()
    };
    let norm = |v: &[f32]| -> Vec<f32> {
        let (mut lo, mut hi) = (f32::MAX, f32::MIN);
        for &x in v {
            lo = lo.min(x);
            hi = hi.max(x);
        }
        let span = (hi - lo).max(1e-8);
        v.iter().map(|&x| (x - lo) / span).collect()
    };

    let e = norm(&mov_avg(&spec.broadband));
    let n = norm(&mov_avg(&spec.total_flux));
    let len = e.len().min(n.len());
    let step = (fps / 10.0).round() as usize; // -> 10fps

    let curve: Vec<f32> = (0..len)
        .step_by(step.max(1))
        .map(|i| r4(0.7 * e[i] + 0.3 * n[i]))
        .collect();

    Tension { frame_rate: 10.0, curve }
}

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 || args.len() > 4 {
        anyhow::bail!("usage: genome-engine <input-audio> <output.json> [emit-44k.wav]");
    }
    let (raw, raw_sr) = load_audio(&args[1])?;
    let (samples, sr) = if raw_sr != 44100 {
        (resample_linear(&raw, raw_sr, 44100), 44100)
    } else {
        (raw, raw_sr)
    };
    if args.len() == 4 {
        write_wav44(&args[3], &samples)?;
    }
    let duration = samples.len() as f32 / sr as f32;

    let env = envelopes(&samples, sr);
    let spec = spectral(&samples, sr);
    let ons = onsets(&spec);
    let wob = wobble(&spec);
    let ten = tension(&spec);

    let out = Output {
        sample_rate: sr,
        duration: r4(duration),
        envelopes: env,
        bands: Bands {
            frame_rate: r4(spec.frame_rate),
            names: BANDS.iter().map(|(n, _, _)| *n).collect(),
            energy: spec.band_energy,
            flux: spec.band_flux,
            centroid: spec.centroid,
        },
        onsets: ons,
        wobble: wob,
        tension: ten,
    };

    let file = File::create(&args[2])?;
    serde_json::to_writer(BufWriter::new(file), &out)?;
    eprintln!(
        "genome-engine: {:.1}s @{}Hz -> {} onsets, written to {}",
        duration,
        sr,
        out.onsets.len(),
        args[2]
    );
    Ok(())
}
