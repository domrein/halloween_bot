import type { Config } from "./config.ts";
import { concatBytes, followText } from "./bytes.ts";
import { takeJpegs } from "./jpeg.ts";
import { ffmpegFailure, stopProcess } from "./proc.ts";

export class Camera {
  private proc: Bun.Subprocess | null = null;
  private frame: Uint8Array | null = null;
  private stopping = false;
  private failure: Error | null = null;
  private stderr = { current: () => "", finished: Promise.resolve("") };

  constructor(private readonly config: Config) {}

  latest(): Uint8Array | null {
    return this.frame;
  }

  check(): void {
    if (this.failure) throw this.failure;
  }

  async start(): Promise<void> {
    const input = `${this.config.cameraDevice}:none`;
    const args = [
      "ffmpeg",
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-f",
      "avfoundation",
      // The camera only accepts modes it lists (size + 30 fps + uyvy422).
      // frameRate then keeps just a couple of JPEGs per second.
      "-framerate",
      "30",
      "-video_size",
      `${this.config.frameWidth}x${this.config.frameHeight}`,
      "-i",
      input,
      "-vf",
      `fps=${this.config.frameRate},scale=${this.config.frameWidth}:${this.config.frameHeight}`,
      "-q:v",
      "7",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ];
    if (this.config.cameraPixelFormat) {
      const insertAt = args.indexOf("-i");
      args.splice(insertAt, 0, "-pixel_format", this.config.cameraPixelFormat);
    }

    this.proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    this.stderr = followText(this.proc.stderr);
    void this.readLoop();

    const deadline = Date.now() + 20_000;
    while (!this.frame && Date.now() < deadline) {
      if (this.failure) throw this.failure;
      const err = ffmpegFailure(this.stderr.current());
      if (err) {
        this.stop();
        throw new Error(cameraError(input, err));
      }
      const exitCode = this.proc.exitCode;
      if (exitCode !== null) {
        throw new Error(cameraError(input, await this.stderr.finished));
      }
      await Bun.sleep(100);
    }
    if (!this.frame) {
      const err = this.stderr.current();
      this.stop();
      throw new Error(cameraError(input, err));
    }
  }

  stop(): void {
    this.stopping = true;
    stopProcess(this.proc);
  }

  private async readLoop(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === "number") return;
    const reader = stdout.getReader();
    let pending = new Uint8Array();
    try {
      while (!this.stopping) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        pending = concatBytes(pending, value);
        const { frames, rest } = takeJpegs(pending);
        pending = rest;
        const last = frames.at(-1);
        if (last) this.frame = last;
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
    if (!this.stopping && this.proc) {
      const code = await this.proc.exited;
      if (code !== 0) {
        const err = await this.stderr.finished;
        this.failure = new Error(cameraError(`${this.config.cameraDevice}:none`, err || `ffmpeg exited ${code}`));
      }
    }
  }
}

function cameraError(input: string, detail: string): string {
  const tail = detail
    ? ` ${detail}`
    : " No frames arrived. Allow Camera access for this terminal in System Settings, then try again.";
  return `Camera failed to open (${input}).${tail}`;
}
