import type { Config } from "./config.ts";
import { followText } from "./bytes.ts";
import { projectPath } from "./paths.ts";
import { stopProcess } from "./proc.ts";
import { encodeWav } from "./wav.ts";

let server: WhisperServer | null = null;

export async function startWhisper(config: Config): Promise<void> {
  if (!server) server = new WhisperServer(config);
  await server.start();
}

export function stopWhisper(): void {
  server?.stop();
  server = null;
}

export async function transcribe(config: Config, pcm: Int16Array): Promise<string> {
  if (!server) await startWhisper(config);
  return server!.transcribe(pcm, config.sampleRate);
}

class WhisperServer {
  private proc: Bun.Subprocess | null = null;
  private owned = false;
  private stderr = { current: () => "", finished: Promise.resolve("") };

  constructor(private readonly config: Config) {}

  async start(): Promise<void> {
    if (await this.reachable()) return;
    const modelPath = projectPath(this.config.whisperModel);
    this.proc = Bun.spawn(
      [
        this.config.whisperBin,
        "-m",
        modelPath,
        "--host",
        "127.0.0.1",
        "--port",
        String(this.config.whisperPort),
        "-l",
        "en",
        "-nt",
      ],
      { stdout: "ignore", stderr: "pipe", stdin: "ignore" },
    );
    this.owned = true;
    this.stderr = followText(this.proc.stderr);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await this.reachable()) return;
      if (this.proc.exitCode !== null) {
        throw new Error(`Whisper server exited. ${await this.stderr.finished}`.trim());
      }
      await Bun.sleep(200);
    }
    this.stop();
    throw new Error(`Whisper server did not start on port ${this.config.whisperPort}. ${this.stderr.current()}`.trim());
  }

  async transcribe(pcm: Int16Array, sampleRate: number): Promise<string> {
    const wav = new Uint8Array(encodeWav(pcm, sampleRate));
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "utterance.wav");
    form.append("response_format", "json");
    form.append("language", "en");
    form.append("temperature", "0");
    const response = await fetch(`${this.url()}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(raw.slice(0, 400) || `Whisper returned ${response.status}`);
    let text = raw;
    try {
      const body = JSON.parse(raw) as { text?: string };
      if (typeof body.text === "string") text = body.text;
    } catch {
      // The server sometimes returns plain text.
    }
    return text
      .replace(/\[[0-9:.]+\s+-->\s+[0-9:.]+\]/g, "")
      .replace(/\[BLANK_AUDIO\]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  stop(): void {
    if (this.owned) stopProcess(this.proc);
    this.proc = null;
    this.owned = false;
  }

  private url(): string {
    return `http://127.0.0.1:${this.config.whisperPort}`;
  }

  private async reachable(): Promise<boolean> {
    try {
      const response = await fetch(this.url(), { signal: AbortSignal.timeout(500) });
      return response.status < 500;
    } catch {
      return false;
    }
  }
}
