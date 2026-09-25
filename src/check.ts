import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reply } from "./brain.ts";
import { Camera } from "./camera.ts";
import { loadConfig } from "./config.ts";
import { Listener } from "./listen.ts";
import { preflight } from "./preflight.ts";
import { startWhisper, stopWhisper, transcribe } from "./whisper.ts";
import { speak, synthesize, warmVoice } from "./voice.ts";
import { decodeS16le } from "./wav.ts";
import { pipeText } from "./bytes.ts";

const config = await loadConfig();
let failed = false;
let cameraFailed = false;
let brainReady = true;

function report(error: unknown): void {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
}

console.log("checking whisper and ollama");
try {
  await preflight(config);
  console.log("whisper and ollama are ready");
} catch (error) {
  brainReady = false;
  report(error);
}

console.log("loading voice");
try {
  await warmVoice();
  console.log(`voice ${config.voice} is ready`);
} catch (error) {
  brainReady = false;
  report(error);
}

let frame: Uint8Array | null = null;
console.log("opening camera");
const camera = new Camera(config);
try {
  await camera.start();
  frame = camera.latest();
  console.log(`camera frame ${frame?.byteLength ?? 0} bytes`);
} catch (error) {
  cameraFailed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  camera.stop();
}

console.log("opening microphone");
const listener = new Listener(config);
try {
  await listener.start();
  console.log("microphone is delivering audio");
} catch (error) {
  report(error);
} finally {
  listener.stop();
}

if (brainReady) {
  try {
    console.log("transcribing a test phrase");
    await startWhisper(config);
    const wav = await synthesize(config, "Trick or treat.");
    const pcm = await toPcm(wav, config.sampleRate);
    const transcript = await transcribe(config, pcm);
    console.log(`heard: ${transcript || "(silence)"}`);
    if (!/trick|treat/i.test(transcript)) {
      throw new Error("Whisper did not hear the test phrase.");
    }

    console.log("asking for a reply");
    const line = await reply(config, transcript, frame);
    console.log(`reply: ${line}`);
    console.log("speaking");
    await speak(config, line);
  } catch (error) {
    report(error);
  } finally {
    stopWhisper();
  }
}

if (failed) process.exit(1);
if (cameraFailed) {
  console.error("The ghost can listen and talk. Costumes stay out until Camera access is allowed for this terminal.");
  process.exit(1);
}
console.log("ready");

async function toPcm(wav: Uint8Array, sampleRate: number): Promise<Int16Array> {
  const dir = await mkdtemp(join(tmpdir(), "halloween-bot-"));
  const wavPath = join(dir, "voice.wav");
  try {
    await Bun.write(wavPath, wav);
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        wavPath,
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "s16le",
        "pipe:1",
      ],
      { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const stdout = proc.stdout;
    if (!stdout || typeof stdout === "number") throw new Error("ffmpeg returned no audio");
    const reader = stdout.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const stderr = await pipeText(proc.stderr);
    const code = await proc.exited;
    if (code !== 0) throw new Error(stderr || `ffmpeg exited ${code}`);
    let length = 0;
    for (const chunk of chunks) length += chunk.length;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return decodeS16le(bytes).pcm;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
