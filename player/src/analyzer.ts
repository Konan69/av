/**
 * Drop one file. This figures out the rest:
 *   hash -> library hit? play : POST to the genome analyzer (Modal, GPU,
 *   cached server-side by the same hash) -> store -> play.
 */
import { assertGenome, type Genome } from "./genome";
import { getTrack, putTrack, sha256, type TrackRecord } from "./library";

export const ANALYZER_URL: string =
	(import.meta.env.VITE_GENOME_URL as string | undefined) ??
	"https://YOUR-WORKSPACE--genome-analyzer-analyzer-web.modal.run";

export type Stage =
	| { kind: "hashing" }
	| { kind: "cached" }
	| { kind: "uploading"; pct: number }
	| { kind: "listening"; seconds: number }
	| { kind: "ready" };

export async function analyzeBlob(
	blob: Blob,
	name: string,
	onStage: (s: Stage) => void,
	signal?: AbortSignal,
): Promise<TrackRecord> {
	signal?.throwIfAborted();
	onStage({ kind: "hashing" });
	const sha = await sha256(blob);
	signal?.throwIfAborted();
	const hit = await getTrack(sha);
	signal?.throwIfAborted();
	if (hit) {
		onStage({ kind: "cached" });
		return hit;
	}

	const genome = await postAnalyze(blob, name, onStage, signal);
	signal?.throwIfAborted();
	if (genome.track_sha256 !== sha)
		throw new Error(`analyzer hash mismatch (${genome.track_sha256.slice(0, 8)} vs ${sha.slice(0, 8)})`);
	const rec: TrackRecord = { sha, name, size: blob.size, addedAt: Date.now(), audio: blob, genome };
	await putTrack(rec);
	signal?.throwIfAborted();
	onStage({ kind: "ready" });
	return rec;
}

function postAnalyze(blob: Blob, name: string, onStage: (s: Stage) => void, signal?: AbortSignal): Promise<Genome> {
	return new Promise((res, rej) => {
		const form = new FormData();
		form.append("file", blob, name);
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${ANALYZER_URL}/analyze`);
		xhr.responseType = "json";
		xhr.timeout = 30 * 60 * 1000;
		const t0 = performance.now();
		let tick: number | undefined;
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onStage({ kind: "uploading", pct: e.loaded / e.total });
		};
		xhr.upload.onload = () => {
			tick = window.setInterval(
				() => onStage({ kind: "listening", seconds: (performance.now() - t0) / 1000 }),
				500,
			);
		};
		const abort = () => xhr.abort();
		const done = () => {
			if (tick !== undefined) clearInterval(tick);
			signal?.removeEventListener("abort", abort);
		};
		xhr.onabort = () => {
			done();
			rej(new DOMException("Analysis cancelled", "AbortError"));
		};
		xhr.onload = () => {
			done();
			if (xhr.status < 200 || xhr.status >= 300) {
				const detail =
					(xhr.response && (xhr.response.detail ?? JSON.stringify(xhr.response))) || xhr.statusText;
				rej(new Error(`analyzer ${xhr.status}: ${String(detail).slice(0, 300)}`));
				return;
			}
			try {
				res(assertGenome(xhr.response));
			} catch (e) {
				rej(e);
			}
		};
		xhr.onerror = () => {
			done();
			rej(new Error(`analyzer unreachable at ${ANALYZER_URL}`));
		};
		xhr.ontimeout = () => {
			done();
			rej(new Error("analyzer timed out"));
		};
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) { done(); rej(new DOMException("Analysis cancelled", "AbortError")); return; }
		xhr.send(form);
	});
}

/** Tracks the dev server exposes from your music folder (see vite.config.ts). */
export interface FolderTrack {
	name: string;
	size: number;
}

export async function listFolder(): Promise<FolderTrack[]> {
	const r = await fetch("/api/tracks");
	if (!r.ok) return [];
	return (await r.json()) as FolderTrack[];
}

export async function fetchFolderTrack(name: string): Promise<Blob> {
	const r = await fetch(`/api/tracks/${encodeURIComponent(name)}`);
	if (!r.ok) throw new Error(`could not read ${name} from the music folder`);
	return r.blob();
}
