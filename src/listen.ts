import type { Config } from "./config.ts";
import { followText } from "./bytes.ts";
import { ffmpegFailure, stopProcess } from "./proc.ts";
import { pcmRms, UtteranceDetector } from "./vad.ts";
import { decodeS16le } from "./wav.ts";

const LEVEL_LOG_EVERY = 50;

export class Listener {
  private proc: Bun.Subprocess | null = null;
  private detector: UtteranceDetector;
  private paused = false;
  private stopping = false;
  private failure: Error | null = null;
  private stderr = { current: () => "", finished: Promise.resolve("") };
  private heardAudio = false;
  private queue: Int16Array[] = [];
  private waiters: Array<(utterance: Int16Array | null) => void> = [];
  private pending = new Int16Array();
  private oddByte = new Uint8Array();
  private levelFrames = 0;
  private levelSum = 0;

  constructor(private readonly config: Config) {
    this.detector = new UtteranceDetector({
      sampleRate: config.sampleRate,
      silenceMs: config.silenceMs,
      minSpeechMs: config.minSpeechMs,
      maxSpeechMs: config.maxSpeechMs,
      levelThreshold: config.levelThreshold,
      preRollMs: 300,
    });
  }

  pause(): void {
    this.paused = true;
    this.pending = new Int16Array();
    this.detector.reset();
  }

  resume(): void {
    this.paused = false;
  }

  async start(): Promise<void> {
    const input = `none:${this.config.micDevice}`;
    this.proc = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-i",
        input,
        "-ac",
        "1",
        "-ar",
        String(this.config.sampleRate),
        "-f",
        "s16le",
        "pipe:1",
      ],
      { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    this.stderr = followText(this.proc.stderr);
    void this.readLoop();

    const deadline = Date.now() + 20_000;
    while (!this.heardAudio && Date.now() < deadline) {
      if (this.failure) throw this.failure;
      const err = ffmpegFailure(this.stderr.current());
      if (err) {
        this.stop();
        throw new Error(micError(input, err));
      }
      if (this.proc.exitCode !== null) {
        throw new Error(micError(input, (await this.stderr.finished) || `ffmpeg exited ${this.proc.exitCode}`));
      }
      await Bun.sleep(100);
    }
    if (!this.heardAudio) {
      const err = this.stderr.current();
      this.stop();
      throw new Error(micError(input, err));
    }
  }

  stop(): void {
    this.stopping = true;
    stopProcess(this.proc);
    this.finish(null);
  }

  async *utterances(): AsyncGenerator<Int16Array> {
    while (!this.stopping) {
      if (this.failure) throw this.failure;
      const next = await this.nextUtterance();
      if (next === null) {
        if (this.failure) throw this.failure;
        return;
      }
      yield next;
    }
  }

  private nextUtterance(): Promise<Int16Array | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private finish(utterance: Int16Array | null): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(utterance);
      return;
    }
    if (!utterance) return;
    this.queue.push(utterance);
    if (this.queue.length > 2) {
      this.queue.shift();
      console.log("dropped audio while transcribing");
    }
  }

  private async readLoop(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === "number") return;
    const reader = stdout.getReader();
    const frameSamples = Math.floor(this.config.sampleRate / 10);
    try {
      while (!this.stopping) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const bytes = this.oddByte.length ? concatBytes(this.oddByte, value) : value;
        const { pcm, rest } = decodeS16le(bytes);
        this.oddByte = rest;
        if (pcm.length > 0) this.heardAudio = true;
        if (this.paused) {
          this.pending = new Int16Array();
          continue;
        }
        this.pending = concatPcm(this.pending, pcm);
        while (this.pending.length >= frameSamples) {
          const frame = new Int16Array(frameSamples);
          frame.set(this.pending.subarray(0, frameSamples));
          const restPcm = new Int16Array(this.pending.length - frameSamples);
          restPcm.set(this.pending.subarray(frameSamples));
          this.pending = restPcm;
          this.onFrame(frame);
        }
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }

    if (!this.stopping && this.proc) {
      const code = await this.proc.exited;
      if (code !== 0) {
        const err = await this.stderr.finished;
        this.failure = new Error(micError(`none:${this.config.micDevice}`, err || `ffmpeg exited ${code}`));
      }
    }
    this.finish(null);
  }

  private onFrame(frame: Int16Array): void {
    if (this.paused) return;
    this.levelFrames++;
    this.levelSum += pcmRms(frame);
    if (this.levelFrames >= LEVEL_LOG_EVERY) {
      const level = this.levelSum / this.levelFrames;
      console.log(`mic level ${level.toFixed(3)} (threshold ${this.config.levelThreshold})`);
      this.levelFrames = 0;
      this.levelSum = 0;
    }
    const utterance = this.detector.push(frame);
    if (utterance) this.finish(utterance);
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function concatPcm(a: Int16Array, b: Int16Array) {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function micError(input: string, detail: string): string {
  const tail = detail ? ` ${detail}` : "";
  return `Microphone failed to open (${input}). Check micDevice in config.json and macOS Microphone permission for this terminal.${tail}`;
}
