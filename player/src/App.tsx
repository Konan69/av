import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeBlob, fetchFolderTrack, listFolder, type Stage } from "./analyzer";
import { Transport } from "./audio";
import { Conductor } from "./conductor";
import type { Genome } from "./genome";
import { deleteTrack, getTrack, listTracks, type TrackMeta } from "./library";
import { Overlay } from "./Overlay";
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
	// exactly one Transport may be alive at a time: each owns an AudioContext,
	// so an abandoned one keeps playing over the new track forever.
	const liveRef = useRef<Live | null>(null);
	const startingRef = useRef(false);

	const refresh = useCallback(() => {
		void listTracks().then(setLib);
		void listFolder().then(setFolder);
	}, []);
	useEffect(refresh, [refresh]);

	const stopCurrent = useCallback(() => {
		liveRef.current?.transport.dispose();
		liveRef.current = null;
		setLive(null);
	}, []);

	const start = useCallback(
		async (blob: Blob, name: string) => {
			// a second click while the first is still resolving used to spawn a
			// second player on top of the first
			if (startingRef.current) return;
			startingRef.current = true;
			stopCurrent();
			setErr("");
			try {
				const rec = await analyzeBlob(blob, name, setStage);
				const transport = new Transport();
				await transport.load(rec.audio);
				const seed = seedFromSha(rec.sha);
				const conductor = new Conductor(rec.genome, seed);
				const next: Live = { genome: rec.genome, conductor, transport, seed, name: rec.name };
				setStage(null);
				liveRef.current = next;
				setLive(next);
				void transport.play();
				refresh();
			} catch (e) {
				setStage(null);
				setErr(e instanceof Error ? e.message : String(e));
			} finally {
				startingRef.current = false;
			}
		},
		[refresh, stopCurrent],
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

	// dev-only handle so a headless browser can park the transport at an exact
	// timestamp while the look is being worked on
	useEffect(() => {
		if (!live || !import.meta.env.DEV) return;
		(window as unknown as { __player?: unknown }).__player = {
			seek: (t: number) => void live.transport.seek(t),
			play: () => void live.transport.play(),
			pause: () => live.transport.pause(),
			get time() {
				return live.transport.time;
			},
			get duration() {
				return live.transport.duration;
			},
		};
	}, [live]);

	useEffect(() => {
		if (!live) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.code === "Space") {
				e.preventDefault();
				void live.transport.toggle();
			}
			if (e.code === "Escape") {
				stopCurrent();
				refresh();
			}
		};
		addEventListener("keydown", onKey);
		return () => removeEventListener("keydown", onKey);
	}, [live, refresh, stopCurrent]);

	if (live)
		return (
			<>
				<Leva collapsed />
				<Canvas
					gl={{ antialias: false, powerPreference: "high-performance" }}
					dpr={[1, 1.75]}
					camera={{ position: [0, 7, 16], fov: 55, near: 0.1, far: 300 }}
					onPointerDown={() => {
						if (!live.transport.playing) void live.transport.play();
					}}
				>
					<World live={live} />
				</Canvas>
				<Overlay live={live} />
				{/* the readout is pointer-transparent; this strip carries the scrub */}
				<div
					className="seek"
					onClick={(e) => {
						const M = 26;
						const f = (e.clientX - M) / Math.max(1, innerWidth - 2 * M);
						void live.transport.seek(Math.max(0, Math.min(1, f)) * live.transport.duration);
					}}
				/>
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
											<button
												type="button"
												className="row"
												disabled={stage !== null}
												onClick={() => void openLibrary(t.sha)}
											>
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
												disabled={stage !== null}
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
