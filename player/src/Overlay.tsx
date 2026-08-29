/**
 * THE READOUT — a 2D instrument frame over the 3D, in nw_wrld's grammar:
 * corner brackets, tick-marked rulers, grid dots, scan lines that sweep on the
 * downbeat, and technical type. Monochrome with one accent.
 *
 * It is not chrome bolted onto the visual — the framing IS part of the image,
 * and every mark on it is a measurement of the track.
 */
import { useEffect, useRef } from "react";
import type { Live } from "./App";
import { cssColor, ink } from "./palette";

const FONT = '10px ui-monospace, "Cascadia Mono", monospace';

export function Overlay({ live }: { live: Live }) {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const cv = ref.current;
		if (!cv) return;
		const ctx = cv.getContext("2d");
		if (!ctx) return;
		const { conductor, genome, seed } = live;

		let raf = 0;
		let lastDb = -1;
		let secIdx = -1;
		let secFlash = 0;
		const scans: { t0: number }[] = [];

		const resize = () => {
			const dpr = Math.min(2, devicePixelRatio || 1);
			cv.width = Math.floor(innerWidth * dpr);
			cv.height = Math.floor(innerHeight * dpr);
			cv.style.width = `${innerWidth}px`;
			cv.style.height = `${innerHeight}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		addEventListener("resize", resize);

		const draw = () => {
			raf = requestAnimationFrame(draw);
			const s = conductor.last;
			if (!s) return;
			const W = innerWidth;
			const H = innerHeight;
			const now = performance.now();
			const pal = ink(seed, genome.sections.labels, s.probs, s.ambiguity);
			const accent = cssColor(pal.accent, 1);
			const white = (a: number) => `rgba(255,255,255,${a.toFixed(3)})`;

			// discrete events, on the grid
			if (s.downbeatIndex !== lastDb) {
				lastDb = s.downbeatIndex;
				if (s.downbeatIndex % 4 === 0) scans.push({ t0: now });
			}
			const si = conductor.sections.indexOf(s.section);
			if (si !== secIdx) {
				secIdx = si;
				secFlash = 1;
				scans.push({ t0: now });
			}
			secFlash = Math.max(0, secFlash - 0.02);

			ctx.clearRect(0, 0, W, H);
			const M = 26; // margin
			const inkA = 0.25 + 0.6 * pal.ink;

			// ── grid dots, pulsing on the beat ──────────────────────────────
			const gx = 34;
			const gy = 22;
			ctx.fillStyle = white(0.05 + 0.1 * s.beatPulse * pal.ink);
			for (let i = 1; i < gx; i++)
				for (let j = 1; j < gy; j++) ctx.fillRect((i / gx) * W - 0.5, (j / gy) * H - 0.5, 1, 1);

			// ── rulers: bars along the bottom, amplitude up the left ────────
			ctx.strokeStyle = white(inkA * 0.5);
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(M, H - M);
			ctx.lineTo(W - M, H - M);
			ctx.moveTo(M, M);
			ctx.lineTo(M, H - M);
			ctx.stroke();

			const dur = genome.duration || 1;
			ctx.strokeStyle = white(inkA * 0.35);
			ctx.beginPath();
			conductor.downbeats.forEach((d, i) => {
				const x = M + (d / dur) * (W - 2 * M);
				const big = i % 8 === 0;
				ctx.moveTo(x, H - M);
				ctx.lineTo(x, H - M - (big ? 8 : 4));
			});
			ctx.stroke();

			ctx.fillStyle = white(inkA * 0.5);
			ctx.font = FONT;
			conductor.downbeats.forEach((d, i) => {
				if (i % 32 !== 0) return;
				const x = M + (d / dur) * (W - 2 * M);
				ctx.fillText(String(i), x + 2, H - M + 12);
			});

			// section blocks on the ruler — the map, drawn as measurement
			conductor.sections.forEach((sec) => {
				const x0 = M + (sec.start / dur) * (W - 2 * M);
				const x1 = M + (sec.end / dur) * (W - 2 * M);
				const on = sec === s.section;
				ctx.fillStyle = on ? accent : white(0.18 + 0.25 * pal.ink);
				ctx.fillRect(x0, H - M - 2, Math.max(1, x1 - x0 - 1), 2);
				ctx.fillStyle = white(on ? 0.75 : 0.25);
				ctx.fillText(sec.label.slice(0, 3).toUpperCase(), x0 + 2, H - M - 6);
			});

			// playhead
			const px = M + (s.time / dur) * (W - 2 * M);
			ctx.strokeStyle = accent;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(px, M);
			ctx.lineTo(px, H - M);
			ctx.stroke();

			// amplitude ticks up the left rail — the nerves
			const rails = 40;
			for (let i = 0; i < rails; i++) {
				const f = i / rails;
				const y = H - M - f * (H - 2 * M);
				const lit = s.rms > f * 1.05;
				ctx.fillStyle = lit ? (f > 0.75 ? accent : white(0.55 * pal.ink + 0.2)) : white(0.07);
				ctx.fillRect(M - 6, y - 1, 4, 2);
			}

			// ── corner brackets, snapping on section change ─────────────────
			const cs = 16 + 26 * secFlash + 8 * s.barPulse;
			ctx.strokeStyle = white(0.35 + 0.5 * pal.ink);
			ctx.lineWidth = 1;
			const corner = (x: number, y: number, dx: number, dy: number) => {
				ctx.beginPath();
				ctx.moveTo(x, y + dy * cs);
				ctx.lineTo(x, y);
				ctx.lineTo(x + dx * cs, y);
				ctx.stroke();
			};
			corner(M * 0.55, M * 0.55, 1, 1);
			corner(W - M * 0.55, M * 0.55, -1, 1);
			corner(M * 0.55, H - M * 0.55, 1, -1);
			corner(W - M * 0.55, H - M * 0.55, -1, -1);

			// ── scan lines ──────────────────────────────────────────────────
			for (let i = scans.length - 1; i >= 0; i--) {
				const age = (now - scans[i].t0) / 520;
				if (age >= 1) {
					scans.splice(i, 1);
					continue;
				}
				const x = M + age * (W - 2 * M);
				ctx.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - age)).toFixed(3)})`;
				ctx.beginPath();
				ctx.moveTo(x, M);
				ctx.lineTo(x, H - M);
				ctx.stroke();
			}

			// ── readout ─────────────────────────────────────────────────────
			const bar = conductor.downbeats.filter((d) => d <= s.time).length;
			const mm = Math.floor(s.time / 60);
			const ss = (s.time % 60).toFixed(1).padStart(4, "0");
			ctx.fillStyle = white(0.9);
			ctx.font = '12px ui-monospace, "Cascadia Mono", monospace';
			ctx.fillText(s.section.label.toUpperCase().split("").join(" "), M + 12, M + 16);
			ctx.font = FONT;
			ctx.fillStyle = white(0.45);
			ctx.fillText(
				`${mm}:${ss}   ${genome.beats.bpm ?? "?"} BPM   BAR ${Math.max(1, bar)}${
					s.morph > 0.01 ? `   ->${s.nextLabel.toUpperCase()} ${(s.morph * 100).toFixed(0)}%` : ""
				}`,
				M + 12,
				M + 30,
			);
			if (s.ambiguity > 0.35) {
				ctx.fillStyle = accent;
				ctx.fillText(`UNDECIDED ${(s.ambiguity * 100).toFixed(0)}%`, M + 12, M + 42);
			}

			// the cast, as a channel strip
			let y = M + 62;
			for (const v of s.voices) {
				ctx.fillStyle = white(0.55);
				ctx.fillText(v.role.toUpperCase(), M + 12, y);
				ctx.fillStyle = white(0.3);
				ctx.fillText(v.stem, M + 78, y);
				const bw = 70;
				ctx.fillStyle = white(0.1);
				ctx.fillRect(M + 132, y - 4, bw, 3);
				const lvl = Math.min(1, v.level * 0.8 + v.punch * 0.45);
				ctx.fillStyle = v.punch > 0.35 ? accent : white(0.7);
				ctx.fillRect(M + 132, y - 4, bw * lvl, 3);
				y += 14;
			}

			ctx.fillStyle = white(0.22);
			ctx.fillText(live.name.toUpperCase(), M + 12, H - M - 16);
		};
		draw();

		return () => {
			cancelAnimationFrame(raf);
			removeEventListener("resize", resize);
		};
	}, [live]);

	return <canvas ref={ref} className="overlay" />;
}
