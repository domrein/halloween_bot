import type { Camera } from "./camera.ts";
import type { Config } from "./config.ts";
import type { ContextLog } from "./context.ts";
import { describeScene } from "./brain.ts";

const GAP_MS = 5_000;

export class Glances {
  private note = "";
  private fingerprint = "";
  private held = 0;
  private running = false;
  private abort: AbortController | null = null;

  constructor(
    private readonly config: Config,
    private readonly camera: Camera,
    private readonly context: ContextLog,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  hold(): void {
    this.held += 1;
    this.abort?.abort();
  }

  release(): void {
    this.held = Math.max(0, this.held - 1);
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (this.held > 0) {
        await Bun.sleep(200);
        continue;
      }
      const frame = this.camera.latest();
      if (!frame) {
        await Bun.sleep(500);
        continue;
      }
      const fingerprint = fingerprintFrame(frame);
      if (fingerprint === this.fingerprint) {
        await Bun.sleep(GAP_MS);
        continue;
      }
      const abort = new AbortController();
      this.abort = abort;
      try {
        const note = await describeScene(this.config, frame, abort.signal);
        if (abort.signal.aborted || !this.running) continue;
        this.fingerprint = fingerprint;
        if (note === this.note) continue;
        this.note = note;
        const text = note || "nothing visible";
        this.context.add("seen", text);
        console.log(`glance: ${text}`);
      } catch (error) {
        if (abort.signal.aborted || isAbort(error)) continue;
        console.error(error instanceof Error ? error.message : error);
      } finally {
        if (this.abort === abort) this.abort = null;
      }
      if (this.running && this.held === 0) await Bun.sleep(GAP_MS);
    }
  }
}

function fingerprintFrame(frame: Uint8Array): string {
  let hash = frame.length;
  for (let i = 0; i < frame.length; i += 97) hash = Math.imul(hash, 33) + frame[i]!;
  return String(hash >>> 0);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}
