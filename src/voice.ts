import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoTokenizer, env, StyleTextToSpeech2Model } from "@huggingface/transformers";
import { KokoroTTS, type GenerateOptions } from "kokoro-js";
import type { Config } from "./config.ts";
import { pipeText } from "./bytes.ts";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const COREML_SUBGRAPH = 0x002;
const COREML_MLPROGRAM = 0x010;

let voicePromise: Promise<KokoroTTS> | null = null;
let voiceChain: Promise<unknown> = Promise.resolve();

function exclusiveVoice<T>(job: () => Promise<T>): Promise<T> {
  const run = voiceChain.then(job, job);
  voiceChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function warmVoice(): Promise<KokoroTTS> {
  if (!voicePromise) {
    voicePromise = loadVoice().catch((error: unknown) => {
      voicePromise = null;
      throw error;
    });
  }
  return voicePromise;
}

async function loadVoice(): Promise<KokoroTTS> {
  console.log("voice on cpu");
  return loadKokoro(false);
}

export function openVoice(device: "cpu" | "coreml", threads = 0): Promise<KokoroTTS> {
  return loadKokoro(device === "coreml", threads);
}

export async function timedVoice(
  config: Config,
  tts: KokoroTTS,
  text: string,
): Promise<{ synthesizeMs: number; colorMs: number; wav: Uint8Array }> {
  const started = performance.now();
  const audio = await tts.generate(text, {
    voice: config.voice as GenerateOptions["voice"],
    speed: config.voiceSpeed,
  });
  const synthesizeMs = performance.now() - started;
  const colorStarted = performance.now();
  const wav = await colorVoice(config, new Uint8Array(audio.toWav()));
  return { synthesizeMs, colorMs: performance.now() - colorStarted, wav };
}

async function loadKokoro(coreml: boolean, threads = 0): Promise<KokoroTTS> {
  if (coreml) env.backends.onnx.logSeverityLevel = 3;
  const model = await StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
    dtype: "fp16",
    device: "cpu",
    session_options: {
      ...(threads > 0 ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {}),
      ...(coreml
        ? {
            executionProviders: [
              { name: "coreml" as const, coreMlFlags: COREML_SUBGRAPH | COREML_MLPROGRAM },
              "cpu" as const,
            ],
          }
        : {}),
    },
  });
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  return new KokoroTTS(model, tokenizer);
}

export async function renderVoice(config: Config, text: string): Promise<Uint8Array> {
  return colorVoice(config, await synthesize(config, text));
}

export async function synthesize(config: Config, text: string): Promise<Uint8Array> {
  return exclusiveVoice(async () => {
    const tts = await warmVoice();
    if (!(config.voice in tts.voices)) {
      throw new Error(`Unknown Kokoro voice "${config.voice}".`);
    }
    const audio = await tts.generate(text, {
      voice: config.voice as GenerateOptions["voice"],
      speed: config.voiceSpeed,
    });
    return new Uint8Array(audio.toWav());
  });
}

export function voiceFilter(sampleRate: number, pitch: number, echoMs: number, crackle = 0): string | null {
  const filters: string[] = [];
  if (pitch > 0 && pitch !== 1) {
    const rate = Math.max(1, Math.round(sampleRate * pitch));
    const tempo = (1 / pitch).toFixed(4);
    filters.push(`asetrate=${rate}`, `aresample=${sampleRate}`, `atempo=${tempo}`);
  }
  if (crackle > 0) {
    const wobble = Math.min(0.85, 0.45 + crackle * 0.5).toFixed(2);
    const flutter = Math.min(0.48, 0.22 + crackle * 0.3).toFixed(2);
    filters.push("highpass=f=180", `vibrato=f=4.2:d=${wobble}`, `tremolo=f=5:d=${flutter}`, "crystalizer=i=3");
  }
  if (echoMs > 0) {
    const first = Math.round(echoMs);
    const second = Math.round(echoMs * 2.2);
    filters.push(`aecho=0.7:0.92:${first}|${second}:0.5|0.32`);
  }
  return filters.length > 0 ? filters.join(",") : null;
}

export async function colorVoice(config: Config, wav: Uint8Array): Promise<Uint8Array> {
  const sampleRate = new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(24, true);
  const filter = voiceFilter(sampleRate, config.voicePitch, config.voiceEchoMs, config.voiceCrackle);
  if (!filter) return wav;
  const dir = join(tmpdir(), `halloween-bot-color-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const input = join(dir, "in.wav");
  const output = join(dir, "out.wav");
  await Bun.write(input, wav);
  try {
    const proc = Bun.spawn(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af", filter, output],
      { stdout: "ignore", stderr: "pipe", stdin: "ignore" },
    );
    const stderr = pipeText(proc.stderr);
    const code = await proc.exited;
    if (code !== 0) throw new Error((await stderr) || `ffmpeg exited ${code}`);
    return new Uint8Array(await Bun.file(output).arrayBuffer());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function play(wav: Uint8Array): Promise<void> {
  const wavPath = join(tmpdir(), `halloween-bot-${process.pid}-${Date.now()}.wav`);
  try {
    await Bun.write(wavPath, wav);
    const proc = Bun.spawn(["afplay", wavPath], { stdout: "ignore", stderr: "pipe", stdin: "ignore" });
    const stderr = pipeText(proc.stderr);
    const code = await proc.exited;
    if (code !== 0) {
      const err = await stderr;
      throw new Error(err || `afplay exited ${code}`);
    }
  } finally {
    await rm(wavPath, { force: true });
  }
}

export function startClip(wav: Uint8Array): { stop: () => void; done: Promise<void> } {
  const wavPath = join(tmpdir(), `halloween-bot-${process.pid}-${Date.now()}.wav`);
  let proc: Bun.Subprocess | null = null;
  let stopped = false;
  const done = (async () => {
    await Bun.write(wavPath, wav);
    if (stopped) {
      await rm(wavPath, { force: true });
      return;
    }
    proc = Bun.spawn(["afplay", wavPath], { stdout: "ignore", stderr: "pipe", stdin: "ignore" });
    const stderr = pipeText(proc.stderr);
    const code = await proc.exited;
    await rm(wavPath, { force: true });
    if (!stopped && code !== 0 && code !== null) {
      const err = await stderr;
      if (err) throw new Error(err);
    }
  })();
  return {
    stop: () => {
      stopped = true;
      proc?.kill();
    },
    done,
  };
}

export async function speak(config: Config, text: string): Promise<void> {
  await play(await colorVoice(config, await synthesize(config, text)));
}
