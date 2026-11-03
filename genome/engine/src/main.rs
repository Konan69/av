//! Genome waveform engine — observes a track's physical signals.
//! Nothing here assumes genre, tempo, or structure. It measures:
//!   - waveform envelopes (rms / peak / crest)        ~200fps
//!   - multi-band energy + spectral flux              ~100fps
//!   - onsets (transient events, per-band attributed) ms-precise
//!   - bass-band LFO (wobble) rate + depth            2fps
//!   - tension curve (slow energy + novelty)          10fps
//!   - chroma (pitch classes + tonal presence)        10fps
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
struct Chroma {
    frame_rate: f32,
    pitch_classes: [&'static str; 12],
    bins: Vec<[f32; 12]>,
    strength: Vec<f32>,
}

#[derive(Serialize)]
struct Output {
    sample_rate: u32,
    duration: f32,
    envelopes: Envelopes,
    bands: Bands,
    chroma: Chroma,
    onsets: Vec<Onset>,
    wobble: Wobble,
    tension: Tension,
}

fn r4(x: f32) -> f32 {
    (x * 10000.0).round() / 10000.0
}

fn r3(x: f32) -> f32 {
    (x * 1000.0).round() / 1000.0
}

fn smoothstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
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

/// Independent, bass-resolving STFT. Frame i is centered at i / frame_rate,
/// with zero padding at file edges, on the envelopes' zero-based timeline.
fn chroma(samples: &[f32], sr: u32) -> Chroma {
    const NFFT: usize = 16384;
    const MEDIAN_RADIUS: usize = 20;
    const PEAK_RATIO: f32 = 1.9952623; // 6 dB in magnitude
    const PEAK_RELATIVE_FLOOR: f32 = 1e-3; // -60 dB relative to the full-spectrum peak
    const PEAK_ABSOLUTE_FLOOR: f32 = 1e-6; // -120 dBFS coherent-gain-normalized magnitude
    const CLASS_FLOOR: f32 = 1e-3;
    const POWER_FLOOR: f32 = 1e-7; // -70 dBFS, Hann-power-normalized mean square
    const COMPRESSION: f32 = 10.0;
    let hop = (sr as usize / 10).max(1);
    let frame_count = samples.len().div_ceil(hop);
    // Periodic Hann peaks exactly at NFFT/2, the frame's stated sample time.
    let hann: Vec<f32> = (0..NFFT)
        .map(|i| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / NFFT as f32).cos()))
        .collect();
    let magnitude_scale = 2.0 / hann.iter().sum::<f32>();
    let single_class_clarity =
        1.0 - CLASS_FLOOR.powf(11.0 / 12.0) * 12.0 / (1.0 + 11.0 * CLASS_FLOOR);
    let hann_power = hann.iter().map(|x| x * x).sum::<f32>();
    let power_scale = 2.0 / (NFFT as f32 * hann_power);
    let bin_hz = sr as f32 / NFFT as f32;
    let first_bin = ((40.0 / bin_hz).ceil() as usize).max(1);
    let last_bin = ((5000.0 / bin_hz).floor() as usize).min(NFFT / 2 - 1);

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(NFFT);
    let mut scratch = vec![Complex32::new(0.0, 0.0); fft.get_inplace_scratch_len()];
    let mut buf = vec![Complex32::new(0.0, 0.0); NFFT];
    // Neighbors outside the voting band support peak interpolation and the
    // local noise-floor estimate, but never contribute energy or class votes.
    let mut magnitudes = vec![0.0f32; (last_bin + MEDIAN_RADIUS + 1).min(NFFT / 2 + 1)];
    let mut median_window = [0.0f32; MEDIAN_RADIUS * 2 + 1];
    let mut raw = Vec::with_capacity(frame_count);
    let mut energies = Vec::with_capacity(frame_count);
    let mut rms_powers = Vec::with_capacity(frame_count);
    for center in (0..samples.len()).step_by(hop) {
        let start = center as isize - (NFFT / 2) as isize;
        let mut window_power = 0.0;
        for (i, value) in buf.iter_mut().enumerate() {
            let index = start + i as isize;
            let sample = if index >= 0 {
                samples.get(index as usize).copied().unwrap_or(0.0)
            } else {
                0.0
            };
            let windowed = sample * hann[i];
            window_power += windowed * windowed;
            *value = Complex32::new(windowed, 0.0);
        }
        rms_powers.push(window_power / hann_power);
        fft.process_with_scratch(&mut buf, &mut scratch);
        let frame_peak = buf[..=NFFT / 2]
            .iter()
            .map(|x| x.norm_sqr())
            .fold(0.0f32, f32::max)
            .sqrt();
        let peak_floor =
            (frame_peak * PEAK_RELATIVE_FLOOR).max(PEAK_ABSOLUTE_FLOOR / magnitude_scale);
        for (magnitude, value) in magnitudes.iter_mut().zip(&buf) {
            *magnitude = value.norm();
        }
        let mut classes = [0.0f32; 12];
        let mut energy = 0.0;
        for bin in first_bin..=last_bin {
            energy += buf[bin].norm_sqr() * power_scale;
            let magnitude = magnitudes[bin];
            if magnitude < peak_floor
                || magnitude <= magnitudes[bin - 1]
                || magnitude < magnitudes[bin + 1]
            {
                continue;
            }
            let lo = bin.saturating_sub(MEDIAN_RADIUS);
            let hi = (bin + MEDIAN_RADIUS + 1).min(magnitudes.len());
            let neighborhood = &mut median_window[..hi - lo];
            neighborhood.copy_from_slice(&magnitudes[lo..hi]);
            let midpoint = neighborhood.len() / 2;
            let (_, median, _) = neighborhood.select_nth_unstable_by(midpoint, f32::total_cmp);
            if magnitude <= PEAK_RATIO * *median {
                continue;
            }
            // A quadratic fit to log magnitude resolves semitones between
            // FFT bins, including sub-bass. The peak must stay in 40-5000 Hz.
            let left = magnitudes[bin - 1].max(f32::MIN_POSITIVE).ln();
            let middle = magnitude.ln();
            let right = magnitudes[bin + 1].max(f32::MIN_POSITIVE).ln();
            let curvature = left - 2.0 * middle + right;
            let offset = if curvature < 0.0 {
                (0.5 * (left - right) / curvature).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            let frequency = (bin as f32 + offset) * bin_hz;
            if !(40.0..=5000.0).contains(&frequency) {
                continue;
            }
            let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
            let nearest = midi.round();
            let weight = (std::f32::consts::PI * (midi - nearest)).cos().powi(2);
            let class = (nearest as i32).rem_euclid(12) as usize;
            classes[class] += magnitude * magnitude_scale * weight;
        }
        raw.push(classes);
        energies.push(energy);
    }

    // Nearest-rank 95th percentile over all frames, including silence.
    let mut sorted = energies.clone();
    sorted.sort_unstable_by(f32::total_cmp);
    let reference = sorted
        .get((frame_count * 95).div_ceil(100).saturating_sub(1))
        .copied()
        .unwrap_or(0.0)
        .max(POWER_FLOOR);
    let mut bins = Vec::with_capacity(frame_count);
    let mut strength = Vec::with_capacity(frame_count);
    for ((classes, energy), rms_power) in raw.into_iter().zip(energies).zip(rms_powers) {
        let max = classes.iter().copied().fold(0.0f32, f32::max);
        let clarity = if max > 0.0 {
            // Floor relative to row max: empty and tiny classes must approach
            // the same finite clarity. Pure-sine calibration preserves ramps.
            let floored = classes.map(|x| (x / max).max(CLASS_FLOOR));
            let mean = floored.iter().sum::<f32>() / 12.0;
            let flatness = (floored.iter().map(|x| x.ln()).sum::<f32>() / 12.0).exp() / mean;
            ((1.0 - flatness) / single_class_clarity).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let relative_presence = if energy > 0.0 {
            let db = 10.0 * (energy / reference).log10();
            smoothstep((db + 40.0) / 34.0)
        } else {
            0.0
        };
        let audibility = if rms_power > 0.0 {
            smoothstep((10.0 * rms_power.log10() + 70.0) / 25.0)
        } else {
            0.0
        };
        let tonal_strength = r3(clarity * relative_presence * audibility);
        bins.push(if tonal_strength > 0.0 && max > 0.0 {
            classes.map(|x| r3((COMPRESSION * (x / max)).ln_1p() / COMPRESSION.ln_1p()))
        } else {
            [0.0; 12]
        });
        strength.push(tonal_strength);
    }
    Chroma {
        frame_rate: sr as f32 / hop as f32,
        pitch_classes: [
            "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
        ],
        bins,
        strength,
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
    let chr = chroma(&samples, sr);

    let out = Output {
        sample_rate: sr,
        duration: r4(duration),
        envelopes: env,
        chroma: chr,
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

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 44100;

    fn tones(frequencies: &[f32], seconds: f32) -> Vec<f32> {
        (0..(seconds * SR as f32).round() as usize)
            .map(|i| {
                frequencies
                    .iter()
                    .map(|f| (2.0 * std::f32::consts::PI * f * i as f32 / SR as f32).sin())
                    .sum::<f32>()
                    * (0.5 / frequencies.len() as f32)
            })
            .collect()
    }

    fn top(row: &[f32; 12]) -> usize {
        (0..12).max_by(|&a, &b| row[a].total_cmp(&row[b])).unwrap()
    }

    fn median(values: &[f32]) -> f32 {
        let mut sorted = values.to_vec();
        sorted.sort_unstable_by(f32::total_cmp);
        (sorted[(sorted.len() - 1) / 2] + sorted[sorted.len() / 2]) / 2.0
    }

    fn noise_samples(sample_count: usize) -> Vec<f32> {
        let mut state = 0x12345678u32;
        (0..sample_count)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as f32 / u32::MAX as f32 - 0.5
            })
            .collect()
    }

    fn at_peak_dbfs(samples: &[f32], dbfs: f32) -> Vec<f32> {
        let peak = samples.iter().map(|x| x.abs()).fold(0.0f32, f32::max);
        let gain = 10.0f32.powf(dbfs / 20.0) / peak;
        samples.iter().map(|x| x * gain).collect()
    }

    fn top_three(row: &[f32; 12]) -> [usize; 3] {
        let mut classes: Vec<_> = (0..12).collect();
        classes.sort_unstable_by(|&a, &b| row[b].total_cmp(&row[a]));
        let mut best = [classes[0], classes[1], classes[2]];
        best.sort_unstable();
        best
    }

    fn assert_contract(result: &Chroma, sample_count: usize) {
        assert_eq!(result.frame_rate, 10.0);
        assert_eq!(
            result.pitch_classes,
            ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        );
        assert_eq!(result.bins.len(), sample_count.div_ceil(SR as usize / 10));
        assert_eq!(result.strength.len(), result.bins.len());
        for (row, &strength) in result.bins.iter().zip(&result.strength) {
            for value in row.iter().chain(std::iter::once(&strength)) {
                assert!(value.is_finite() && (0.0..=1.0).contains(value));
                assert_eq!(*value, r3(*value));
            }
            if strength == 0.0 {
                assert_eq!(*row, [0.0; 12]);
            } else {
                assert_eq!(row[top(row)], 1.0);
            }
        }
        serde_json::to_string(result).unwrap();
    }

    fn assert_pitch(frequency: f32, class: usize) {
        let samples = tones(&[frequency], 2.0);
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        let correct = result.bins.iter().filter(|row| top(row) == class).count();
        let accuracy = correct as f32 / result.bins.len() as f32;
        println!(
            "{frequency} Hz: correct={correct}/{} ({accuracy:.3}), median strength={:.3}",
            result.bins.len(),
            median(&result.strength)
        );
        assert!(
            accuracy >= 0.9,
            "{frequency} Hz: {accuracy:.3}, rows={:?}",
            result.bins
        );
    }

    #[test]
    fn a4_sine() {
        let samples = tones(&[440.0], 2.0);
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        for row in &result.bins {
            assert_eq!(row[9], 1.0);
            for (class, &value) in row.iter().enumerate() {
                if class != 9 {
                    assert!(value < 0.25, "class {class}: {value}, row={row:?}");
                }
            }
        }
        let strength = median(&result.strength);
        println!("A4: median strength={strength:.3}");
        assert!(strength > 0.6);
    }

    #[test]
    fn c_major_triad() {
        let samples = tones(&[261.6256, 329.6276, 391.9954], 2.0);
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        for row in &result.bins {
            let mut classes: Vec<usize> = (0..12).collect();
            classes.sort_unstable_by(|&a, &b| row[b].total_cmp(&row[a]));
            let mut best = classes[..3].to_vec();
            best.sort_unstable();
            assert_eq!(best, [0, 4, 7], "row={row:?}");
        }
        println!(
            "C major: C/E/G top three in all {} frames",
            result.bins.len()
        );
    }

    #[test]
    fn e1_bass() {
        assert_pitch(41.2, 4);
    }

    #[test]
    fn a1_bass() {
        assert_pitch(55.0, 9);
    }

    #[test]
    fn a_sharp1_bass() {
        assert_pitch(58.27, 10);
    }

    #[test]
    fn silence() {
        let samples = vec![0.0; SR as usize * 2];
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        assert!(result.strength.iter().all(|&x| x == 0.0));
        assert!(result.bins.iter().all(|row| *row == [0.0; 12]));
    }

    #[test]
    fn white_noise() {
        // Deterministic xorshift32, no test dependency or platform RNG.
        let mut state = 0x12345678u32;
        let samples: Vec<f32> = (0..SR as usize * 2)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as f32 / u32::MAX as f32 - 0.5
            })
            .collect();
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        let strength = median(&result.strength);
        println!("white noise: median strength={strength:.3}");
        assert!(strength < 0.2);
    }

    #[test]
    fn empty_class_clarity_is_continuous() {
        let mut samples = vec![0.0; SR as usize * 2];
        // C5 through A#5; keep equal amplitudes and leave B5 empty.
        for midi in 72..83 {
            let frequency = 440.0 * 2.0f32.powf((midi as f32 - 69.0) / 12.0);
            for (sample, tone) in samples.iter_mut().zip(tones(&[frequency], 2.0)) {
                *sample += tone / 12.0;
            }
        }
        let empty = chroma(&samples, SR);
        let b5 = 440.0 * 2.0f32.powf((83.0 - 69.0) / 12.0);
        for (sample, tone) in samples.iter_mut().zip(tones(&[b5], 2.0)) {
            *sample += tone / 12.0 * 10.0f32.powf(-40.0 / 20.0);
        }
        let faint = chroma(&samples, SR);
        assert_contract(&empty, samples.len());
        assert_contract(&faint, samples.len());
        let max_difference = empty
            .strength
            .iter()
            .zip(&faint.strength)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        println!("11 equal tones vs faint B: median={:.3}/{:.3}, max strength difference={max_difference:.3}",
            median(&empty.strength), median(&faint.strength));
        assert!(max_difference < 0.15);
    }

    #[test]
    fn twenty_second_white_noise_has_bounded_strength() {
        let samples = noise_samples(SR as usize * 20);
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        let max_strength = result.strength.iter().copied().fold(0.0f32, f32::max);
        println!(
            "20 s white noise: median={:.3}, max={max_strength:.3}",
            median(&result.strength)
        );
        assert!(max_strength < 0.6);
    }

    #[test]
    fn below_band_d1_has_no_chroma() {
        let samples = tones(&[36.7], 2.0);
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        assert!(
            result.strength.iter().all(|&x| x == 0.0),
            "strength={:?}",
            result.strength
        );
        assert!(result.bins.iter().all(|row| *row == [0.0; 12]));
    }

    #[test]
    fn two_octave_c_major_scale() {
        let notes = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
        let samples: Vec<f32> = notes
            .iter()
            .flat_map(|&midi| tones(&[440.0 * 2.0f32.powf((midi as f32 - 69.0) / 12.0)], 0.5))
            .collect();
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        for (note_index, &midi) in notes.iter().enumerate() {
            let eligible: Vec<_> = result
                .bins
                .iter()
                .enumerate()
                .filter(|(i, _)| {
                    // Integer sample positions avoid float errors at exactly 0.2s.
                    let position = i * (SR as usize / 10);
                    let start = note_index * (SR as usize / 2);
                    let end = start + SR as usize / 2;
                    position >= start + SR as usize / 5 && position <= end - SR as usize / 5
                })
                .map(|(_, row)| row)
                .collect();
            assert!(!eligible.is_empty());
            let correct = eligible
                .iter()
                .filter(|row| top(row) == midi as usize % 12)
                .count();
            assert!(
                correct as f32 / eligible.len() as f32 >= 0.9,
                "MIDI {midi}: {correct}/{} correct, rows={eligible:?}",
                eligible.len()
            );
        }
        println!("C major scale: all 15 notes correct in boundary-safe frames");
    }

    #[test]
    fn presence_ramp_and_edge_padding() {
        let loud = tones(&[440.0], 2.0);
        let mut samples = loud.clone();
        // Interior of each segment exercises both ramp endpoints and midpoint.
        for attenuation_db in [-6.0, -23.0, -40.0, -60.0] {
            let gain = 10.0f32.powf(attenuation_db / 20.0);
            samples.extend(loud.iter().map(|x| x * gain));
        }
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        assert!(result.strength[10] > 0.99);
        assert!(result.strength[30] > 0.99);
        assert!((result.strength[50] - 0.5).abs() < 0.01);
        assert_eq!(result.strength[70], 0.0);
        assert_eq!(result.strength[90], 0.0);
        // A short file still has a frame at t=0; no full-window requirement.
        let short = chroma(&loud[..100], SR);
        assert_contract(&short, 100);
        assert_eq!(chroma(&[], SR).bins.len(), 0);
    }

    #[test]
    fn mix_like_saw_chord_in_noise() {
        // Band-limited saws retain their harmonic overtones without aliasing.
        let mut samples = vec![0.0f32; SR as usize * 2];
        for frequency in [261.6256, 329.6276, 391.9954] {
            for harmonic in 1..=12 {
                for (i, sample) in samples.iter_mut().enumerate() {
                    let phase = 2.0 * std::f32::consts::PI * frequency * harmonic as f32 * i as f32
                        / SR as f32;
                    *sample += phase.sin() / harmonic as f32;
                }
            }
        }
        let mut noise = noise_samples(samples.len());
        let chord_power = samples.iter().map(|x| x * x).sum::<f32>();
        let noise_power = noise.iter().map(|x| x * x).sum::<f32>();
        let noise_gain = (chord_power / noise_power).sqrt() * 10.0f32.powf(-6.0 / 20.0);
        for (sample, noise_sample) in samples.iter_mut().zip(&mut noise) {
            *sample += *noise_sample * noise_gain;
        }
        let samples = at_peak_dbfs(&samples, -6.0);
        let result = chroma(&samples, SR);
        assert_contract(&result, samples.len());
        let strength = median(&result.strength);
        println!("saw chord + noise (-6 dB RMS relative): median strength={strength:.3}");
        assert!(strength > 0.3);
        // Ignore padded windows; test every interior frame, not just an average.
        for row in &result.bins[2..result.bins.len() - 2] {
            assert_eq!(top_three(row), [0, 4, 7], "row={row:?}");
        }
    }

    #[test]
    fn level_invariance_and_absolute_audibility() {
        let chord = tones(&[261.6256, 329.6276, 391.9954], 2.0);
        // Levels are peak dBFS. This chord's RMS is ~8 dB below its peak,
        // so the -40 dBFS copy enters the -70..-45 dBFS RMS audibility ramp.
        let loud = chroma(&at_peak_dbfs(&chord, -20.0), SR);
        let quiet = chroma(&at_peak_dbfs(&chord, -40.0), SR);
        let inaudible = chroma(&at_peak_dbfs(&chord, -75.0), SR);
        for result in [&loud, &quiet, &inaudible] {
            assert_contract(result, chord.len());
        }
        for (a, b) in loud.bins.iter().zip(&quiet.bins) {
            assert_eq!(top_three(a), [0, 4, 7]);
            assert_eq!(top_three(b), [0, 4, 7]);
            for (&x, &y) in a.iter().zip(b) {
                assert!(
                    (x - y).abs() <= 0.001,
                    "level-dependent rows: {a:?} / {b:?}"
                );
            }
        }
        assert!(median(&quiet.strength) < median(&loud.strength));
        assert!(inaudible.strength.iter().all(|&x| x == 0.0));
        println!(
            "peak -20/-40/-75 dBFS: median strength={:.3}/{:.3}/{:.3}",
            median(&loud.strength),
            median(&quiet.strength),
            median(&inaudible.strength)
        );
    }

    #[test]
    fn absolute_audibility_ramp() {
        let sine = tones(&[440.0], 2.0);
        let rms = (sine.iter().map(|x| x * x).sum::<f32>() / sine.len() as f32).sqrt();
        for (dbfs, expected) in [(-70.0, 0.0), (-57.5, 0.5), (-45.0, 1.0)] {
            let gain = 10.0f32.powf(dbfs / 20.0) / rms;
            let samples: Vec<f32> = sine.iter().map(|x| x * gain).collect();
            let result = chroma(&samples, SR);
            assert_contract(&result, samples.len());
            let strength = median(&result.strength);
            assert!(
                (strength - expected).abs() <= 0.002,
                "{dbfs} dBFS RMS: {strength}"
            );
            println!("absolute ramp {dbfs} dBFS RMS: median strength={strength:.3}");
        }
    }

    #[test]
    fn detuned_sub_bass() {
        for (frequency, cents, class) in [
            (41.20345, -20.0, 4),
            (41.20345, 0.0, 4),
            (41.20345, 20.0, 4),
            (58.27047, -30.0, 10),
            (41.20345, 15.0, 4),
            (41.20345, 30.0, 4),
            (43.65353, 30.0, 5),
            (51.91309, 30.0, 8),
        ] {
            let samples = tones(&[frequency * 2.0f32.powf(cents / 1200.0)], 2.0);
            let result = chroma(&samples, SR);
            assert_contract(&result, samples.len());
            let interior = &result.bins[2..result.bins.len() - 2];
            let correct = interior.iter().filter(|row| top(row) == class).count();
            let accuracy = correct as f32 / interior.len() as f32;
            println!(
                "{frequency} Hz {cents:+} cents: {correct}/{} interior frames correct",
                interior.len()
            );
            assert!(accuracy >= 0.9, "rows={interior:?}");
        }
    }

    #[test]
    fn bleed_stem_and_sparse_stab() {
        let length = SR as usize * 40;
        let mut bleed = noise_samples(length);
        let rms = (bleed.iter().map(|x| x * x).sum::<f32>() / length as f32).sqrt();
        for x in &mut bleed {
            *x *= 10.0f32.powf(-80.0 / 20.0) / rms;
        }
        let chord = at_peak_dbfs(&tones(&[261.6256, 329.6276, 391.9954], 0.3), -20.0);
        // Test both bleed and exactly zero backgrounds: in the latter p95=0.
        for (name, mut samples) in [("bleed", bleed), ("silence", vec![0.0; length])] {
            let start = SR as usize * 20;
            for (sample, stab) in samples[start..].iter_mut().zip(&chord) {
                *sample += stab;
            }
            let result = chroma(&samples, SR);
            assert_contract(&result, length);
            for (i, &strength) in result.strength.iter().enumerate() {
                let center = i * SR as usize / 10;
                if center + 8192 <= start || center >= start + chord.len() + 8192 {
                    assert_eq!(strength, 0.0, "{name} floor frame {i}");
                }
            }
            let stab_strengths = &result.strength[200..203];
            assert!(
                stab_strengths.iter().all(|&x| x > 0.3),
                "{name}: {stab_strengths:?}"
            );
            println!("{name} sparse stab: floor=0, stab strength={stab_strengths:?}");
        }
    }
}
