import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeBlob, fetchFolderTrack, listFolder, type Stage } from "./analyzer";
import { Transport } from "./audio";
import { Conductor } from "./conductor";
import type { Genome } from "./genome";
import { deleteTrack, getTrack, listTracks, type TrackMeta } from "./library";
import { cssColor, palette } from "./palette";
import { seedFromSha, type WorldSeed } from "./seed";
import { World } from "./World";

export interface Live {
	genome: Genome;
	conductor: Conductor;
	transport: Transport;
	seed: WorldSeed;
	name: string;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export default function App() {
	const [live, setLive] = useState<Live | null>(null);
	const [stage, setStage] = useState<Stage | null>(null);
	const [err, setErr] = useState("");
	const [over, setOver] = useState(false);
	const [lib, setLib] = useState<TrackMeta[]>([]);
	const [folder, setFolder] = useState<{ name: string; size: number }[]>([]);
	const pickRef = useRef<HTMLInputElement>(null);

	const refresh = useCallback(() => {
		void listTracks().then(setLib);
		void listFolder().then(setFolder);
	}, []);
	useEffect(refresh, [refresh]);

	const start = useCallback(
		async (blob: Blob, name: string) => {
			setErr("");
			try {
				const rec = await analyzeBlob(blob, name, setStage);
				const transport = new Transport();
				await transport.load(rec.audio);
				const seed = seedFromSha(rec.sha);
				const conductor = new Conductor(rec.genome, seed);
				setStage(null);
				setLive({ genome: rec.genome, conductor, transport, seed, name: rec.name });
				void transport.play();
				refresh();
			} catch (e) {
				setStage(null);
				setErr(e instanceof Error ? e.message : String(e));
			}
		},
		[refresh],
	);

	const openLibrary = useCallback(
		async (sha: string) => {
			const rec = await getTrack(sha);
			if (!rec) return;
			await start(rec.audio, rec.name);
		},
		[start],
	);

	useEffect(() => {
		const onDrop = (e: DragEvent) => {
			e.preventDefault();
			setOver(false);
			const f = e.dataTransfer?.files?.[0];
			if (f) void start(f, f.name);
		};
		const onDrag = (e: DragEvent) => {
			e.preventDefault();
			setOver(true);
		};
		const onLeave = () => setOver(false);
		addEventListener("drop", onDrop);
		addEventListener("dragover", onDrag);
		addEventListener("dragleave", onLeave);
		return () => {
			removeEventListener("drop", onDrop);
			removeEventListener("dragover", onDrag);
			removeEventListener("dragleave", onLeave);
		};
	}, [start]);

	useEffect(() => {
		if (!live) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.code === "Space") {
				e.preventDefault();
				void live.transport.toggle();
			}
			if (e.code === "Escape") {
				live.transport.pause();
				setLive(null);
				refresh();
			}
		};
		addEventListener("keydown", onKey);
		return () => removeEventListener("keydown", onKey);
	}, [live, refresh]);

	if (live)
		return (
			<>
				<Leva collapsed />
				<Canvas
					gl={{ antialias: false, powerPreference: "high-performance" }}
					dpr={[1, 1.75]}
					camera={{ position: [0, 2.3, 9], fov: 60, near: 0.1, far: 260 }}
					onPointerDown={() => {
						if (!live.transport.playing) void live.transport.play();
					}}
				>
					<World live={live} />
				</Canvas>
				<Hud live={live} />
				<Timeline live={live} />
			</>
		);

	return (
		<div className={`shell${over ? " over" : ""}`}>
			<header>
				<h1>GENOME</h1>
				<p>drop a track. it works the rest out.</p>
			</header>

			{stage ? (
				<Progress stage={stage} />
			) : (
				<>
					{err && <p className="err">{err}</p>}
					<div className="lists">
						{lib.length > 0 && (
							<section>
								<h2>library</h2>
								<ul>
									{lib.map((t) => (
										<li key={t.sha}>
											<button type="button" className="row" onClick={() => void openLibrary(t.sha)}>
												<span className="nm">{t.name}</span>
												<span className="meta">
													{fmt(t.duration)} · {t.bpm ?? "?"} bpm
												</span>
											</button>
											<button
												type="button"
												className="x"
												title="forget"
												onClick={() => void deleteTrack(t.sha).then(refresh)}
											>
												×
											</button>
										</li>
									))}
								</ul>
							</section>
						)}
						{folder.length > 0 && (
							<section>
								<h2>music folder</h2>
								<ul>
									{folder.map((f) => (
										<li key={f.name}>
											<button
												type="button"
												className="row"
												onClick={() => void fetchFolderTrack(f.name).then((b) => start(b, f.name))}
											>
												<span className="nm">{f.name}</span>
												<span className="meta">{(f.size / 1e6).toFixed(1)} MB</span>
											</button>
										</li>
									))}
								</ul>
							</section>
						)}
					</div>
					<button type="button" className="pick" onClick={() => pickRef.current?.click()}>
						choose a file
					</button>
					<input
						ref={pickRef}
						type="file"
						id="pick"
						accept="audio/*"
						hidden
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) void start(f, f.name);
						}}
					/>
				</>
			)}
		</div>
	);
}

function Progress({ stage }: { stage: Stage }) {
	const text =
		stage.kind === "hashing"
			? "reading the file"
			: stage.kind === "cached"
				? "already known — opening"
				: stage.kind === "uploading"
					? `sending to the analyzer · ${Math.round(stage.pct * 100)}%`
					: stage.kind === "listening"
						? `listening · separating layers · ${stage.seconds.toFixed(0)}s`
						: "ready";
	const pct = stage.kind === "uploading" ? stage.pct : stage.kind === "listening" ? 1 : 0;
	return (
		<div className="prog">
			<div className="bar2">
				<div className={`fill${stage.kind === "listening" ? " pulse" : ""}`} style={{ width: `${pct * 100}%` }} />
			</div>
			<p>{text}</p>
			{stage.kind === "listening" && <p className="dim">first time for this track only — 1 to 3 minutes on a GPU</p>}
		</div>
	);
}

function Hud({ live }: { live: Live }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => tick((n) => n + 1), 100);
		return () => clearInterval(id);
	}, []);
	// READ the frame the render loop produced. sample() advances integrators
	// and consumes onsets, so only the useFrame loop may ever call it.
	const s = live.conductor.last;
	const t = live.transport.time;
	if (!s) return null;
	const bar = live.conductor.downbeats.filter((d) => d <= t).length;
	return (
		<div className="hud">
			<div className="label">{s.section.label}</div>
			<div className="sub">
				{fmt(t)}.{Math.floor((t % 1) * 10)} · {live.genome.beats.bpm ?? "?"} bpm · bar {Math.max(1, bar)}
				{s.morph > 0.01 ? ` · → ${s.nextLabel} ${(s.morph * 100).toFixed(0)}%` : ""}
				{s.ambiguity > 0.3 ? " · undecided" : ""}
			</div>
			<div className="cast">
				{s.voices.map((v) => (
					<div className="voice" key={v.stem}>
						<span className="role">{v.role}</span>
						<span className="stem">{v.stem}</span>
						<span className="lvl">
							<i style={{ width: `${Math.min(100, v.level * 70 + v.punch * 40)}%` }} />
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function Timeline({ live }: { live: Live }) {
	const [pct, setPct] = useState(0);
	const gradient = useMemo(() => {
		const dur = live.genome.duration;
		const labels = live.genome.sections.labels;
		const stops = live.conductor.sections.flatMap((sec) => {
			const probs = labels.map((l) => (l === sec.label ? 1 : 0));
			const c = cssColor(palette(live.seed, labels, probs).body, 0.95);
			return [`${c} ${(sec.start / dur) * 100}%`, `${c} ${(sec.end / dur) * 100}%`];
		});
		return `linear-gradient(to right, ${stops.join(", ")})`;
	}, [live]);

	useEffect(() => {
		const id = setInterval(() => setPct((live.transport.time / (live.transport.duration || 1)) * 100), 100);
		return () => clearInterval(id);
	}, [live]);

	return (
		<div
			className="bar"
			onClick={(e) => void live.transport.seek((e.clientX / innerWidth) * live.transport.duration)}
		>
			<div className="track" style={{ background: gradient }} />
			<div className="head" style={{ left: `${pct}%` }} />
			<div className="name">{live.name}</div>
		</div>
	);
}
