/**
 * The library: every track you've ever dropped, with its genome, in IndexedDB.
 * You never load a json again — a track is analyzed once, ever.
 */
import { assertGenome, type Genome } from "./genome";

export interface TrackRecord {
	sha: string;
	name: string;
	size: number;
	addedAt: number;
	audio: Blob;
	genome: Genome;
}

export interface TrackMeta {
	sha: string;
	name: string;
	size: number;
	addedAt: number;
	duration: number;
	bpm: number | null;
}

const DB = "genome-library";
const STORE = "tracks";

function open(): Promise<IDBDatabase> {
	return new Promise((res, rej) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "sha" });
		};
		req.onsuccess = () => res(req.result);
		req.onerror = () => rej(req.error);
	});
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((res, rej) => {
				const t = db.transaction(STORE, mode);
				const req = fn(t.objectStore(STORE));
				req.onsuccess = () => res(req.result);
				req.onerror = () => rej(req.error);
			}),
	);
}

export async function sha256(blob: Blob): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function listTracks(): Promise<TrackMeta[]> {
	const all = await tx<TrackRecord[]>("readonly", (s) => s.getAll());
	return all
		.map((r) => ({
			sha: r.sha,
			name: r.name,
			size: r.size,
			addedAt: r.addedAt,
			duration: r.genome.duration,
			bpm: r.genome.beats.bpm,
		}))
		.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getTrack(sha: string): Promise<TrackRecord | undefined> {
	const r = await tx<TrackRecord | undefined>("readonly", (s) => s.get(sha));
	if (r) assertGenome(r.genome);
	return r;
}

export async function putTrack(rec: TrackRecord): Promise<void> {
	await tx("readwrite", (s) => s.put(rec));
}

export async function deleteTrack(sha: string): Promise<void> {
	await tx("readwrite", (s) => s.delete(sha));
}
