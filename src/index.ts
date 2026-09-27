import { firstSpokenSentence, warmModels } from "./brain.ts";
import { Camera } from "./camera.ts";
import { loadConfig } from "./config.ts";
import { ContextLog } from "./context.ts";
import { matchCanned, nextFill, prepareCues, type Cues } from "./cues.ts";
import { Glances } from "./glance.ts";
import { Listener } from "./listen.ts";
import { preflight } from "./preflight.ts";
import { play, renderVoice, startClip, warmVoice } from "./voice.ts";
import { startWhisper, stopWhisper, transcribe } from "./whisper.ts";

const config = await loadConfig();
const camera = new Camera(config);
const listener = new Listener(config);
const context = new ContextLog();
const glances = new Glances(config, camera, context);

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  console.log("\nstopping");
  glances.stop();
  listener.stop();
  camera.stop();
  stopWhisper();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`character ${config.character} (${config.voice})`);
console.log(`camera ${config.cameraDevice}`);
console.log(`microphone ${config.micDevice}`);
try {
  await preflight(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
console.log("starting whisper");
try {
  await startWhisper(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
console.log("loading voice, camera, and microphone");
let cues: Cues | null = null;

function preparedCues(): Cues | null {
  return cues;
}
const voiceReady = warmVoice().then(async () => {
  cues = await prepareCues(config);
});
const modelsReady = warmModels(config);
try {
  await camera.start();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("continuing without a picture");
  camera.stop();
}
try {
  await Promise.all([voiceReady, modelsReady, listener.start()]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopWhisper();
  listener.stop();
  camera.stop();
  process.exit(1);
}
glances.start();
console.log("listening");

function elapsed(started: number): string {
  return `${Math.round(performance.now() - started)}ms`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

process.on("uncaughtException", (error) => {
  if (isAbort(error)) {
    console.error("ignored aborted work");
    return;
  }
  console.error(error);
  process.exit(1);
});

let turn: Promise<void> | null = null;
let breath: { stop: () => void; done: Promise<void> } | null = null;
let fillIndex = -1;

function startDelay(ready: Cues): void {
  fillIndex = nextFill(ready.fills.length, fillIndex);
  const fill = ready.fills[fillIndex];
  if (!fill) return;
  listener.deafen();
  breath = startClip(fill);
}

async function finishDelay(): Promise<void> {
  const current = breath;
  if (!current) {
    listener.undeafen();
    return;
  }
  try {
    await current.done;
  } catch {
    // They started talking again and the phrase was stopped.
  }
  if (breath === current) breath = null;
  listener.undeafen();
}

async function playAnswer(wav: Uint8Array): Promise<void> {
  listener.pause();
  try {
    await play(wav);
  } finally {
    listener.resume();
    console.log("listening");
    if (config.playbackTailMs > 0) {
      listener.deafen();
      await Bun.sleep(config.playbackTailMs);
      listener.undeafen();
    }
  }
}

try {
  for await (const utterance of listener.utterances()) {
    if (stopping) break;
    camera.check();
    const audioMs = Math.round((utterance.pcm.length / config.sampleRate) * 1000);
    const recognizeStarted = performance.now();
    let transcript = "";
    try {
      transcript = await transcribe(config, utterance.pcm);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      console.log(`timing: audio ${audioMs}ms, recognize ${elapsed(recognizeStarted)} failed`);
      continue;
    }
    const heardTiming = `audio ${audioMs}ms, recognize ${elapsed(recognizeStarted)}`;
    console.log(`heard: ${transcript || "(silence)"}`);
    if (!transcript) {
      console.log(`timing: ${heardTiming}`);
      continue;
    }
    context.add("heard", transcript);
    if (turn) {
      console.log("noted");
      console.log(`timing: ${heardTiming}`);
      continue;
    }
    const memory = context.prompt();
    const ready = preparedCues();
    const canned = ready ? matchCanned(ready.lines, transcript) : null;
    turn = (async () => {
      if (canned && canned.wav.byteLength > 0) {
        console.log(`speaking: ${canned.say}`);
        context.add("said", canned.say);
        const playStarted = performance.now();
        await playAnswer(canned.wav);
        console.log(`timing: ${heardTiming}, quick, context ${context.size}, play ${elapsed(playStarted)}`);
        return;
      }
      if (ready) startDelay(ready);
      const delayDone = finishDelay();
      console.log("thinking");
      const replyStarted = performance.now();
      try {
        const line = await firstSpokenSentence(config, memory, AbortSignal.timeout(60_000));
        if (!line) throw new Error("Ollama returned an empty reply");
        const replyMs = elapsed(replyStarted);
        console.log(`speaking: ${line}`);
        context.add("said", line);
        const voiceStarted = performance.now();
        const wav = await renderVoice(config, line);
        const voiceMs = elapsed(voiceStarted);
        await delayDone;
        const playStarted = performance.now();
        await playAnswer(wav);
        console.log(
          `timing: ${heardTiming}, reply ${replyMs}, voice ${voiceMs}, context ${context.size}, play ${elapsed(playStarted)}`,
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        await delayDone;
        console.log(`timing: ${heardTiming}, reply ${elapsed(replyStarted)} failed`);
      }
    })().finally(() => {
      turn = null;
    });
  }
} catch (error) {
  if (!stopping) console.error(error instanceof Error ? error.message : error);
  glances.stop();
  listener.stop();
  camera.stop();
  stopWhisper();
  process.exit(stopping ? 0 : 1);
}
