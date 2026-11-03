import { analyzeBlob, type Stage } from "./analyzer";
import { Transport } from "./audio";
import { Conductor } from "./conductor";
import { assertGenome, type Genome } from "./genome";
import { putTrack, sha256, type TrackRecord } from "./library";
import { seedFromSha, type WorldSeed } from "./seed";

export interface Performance {
  transport: Transport;
  conductor: Conductor;
  genome: Genome;
  seed: WorldSeed;
  name: string;
}

/** One owner for the audio clock, analysis request and current performance. */
export class MusicSession {
  current: Performance | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private pendingTransport: Transport | null = null;
  constructor(private onStage: (stage: Stage) => void = () => {}) {}

  async open(audio: Blob, name: string, suppliedGenome?: unknown): Promise<Performance | null> {
    if (this.disposed) return null;
    this.cancel();
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    this.current?.transport.dispose();
    this.current = null;
    let transport: Transport | null = null;
    const active = () => !this.disposed && generation === this.generation;
    const stage = (s: Stage) => { if (active()) this.onStage(s); };
    try {
      let rec: TrackRecord;
      if (suppliedGenome !== undefined) {
        stage({kind: "hashing"});
        const genome = assertGenome(suppliedGenome);
        const sha = await sha256(audio);
        if (!active()) return null;
        if (sha !== genome.track_sha256) throw new Error("This analysis belongs to a different audio file.");
        rec = {sha, audio, genome, name, size: audio.size, addedAt: Date.now()};
        await putTrack(rec);
      } else {
        rec = await analyzeBlob(audio, name, stage, request.signal);
      }
      if (!active()) return null;
      transport = new Transport();
      this.pendingTransport = transport;
      await transport.load(rec.audio);
      if (!active()) { transport.dispose(); return null; }
      const seed = seedFromSha(rec.sha);
      const conductor = new Conductor(rec.genome, seed);
      this.current = {transport, conductor, genome: rec.genome, seed, name: rec.name};
      stage({kind: "ready"});
      return this.current;
    } catch (error) {
      transport?.dispose();
      if (!active() || request.signal.aborted) return null;
      throw error;
    } finally {
      if (this.pendingTransport === transport) this.pendingTransport = null;
      if (active()) this.request = null;
    }
  }

  cancel() {
    this.generation++;
    this.request?.abort();
    this.pendingTransport?.dispose();
    this.pendingTransport = null;
    this.request = null;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.current?.transport.dispose();
    this.current = null;
  }
}
