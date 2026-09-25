import { firstSpokenSentence, warmModels } from "./brain.ts";
import { Camera } from "./camera.ts";
import { loadConfig } from "./config.ts";
import { ContextLog } from "./context.ts";
import { Glances } from "./glance.ts";
import { Listener } from "./listen.ts";
import { preflight } from "./preflight.ts";
import { startWhisper, stopWhisper, transcribe } from "./whisper.ts";
import { colorVoice, play, synthesize, warmVoice } from "./voice.ts";

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

console.log(`camera ${config.cameraDevice}`);
console.log(`microphone ${config.micDevice}`);
try {
  await preflight(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
console.log("loading voice, whisper, camera, and microphone");
const voiceReady = warmVoice();
const whisperReady = startWhisper(config);
const modelsReady = warmModels(config);
try {
  await camera.start();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("continuing without a picture");
  camera.stop();
}
try {
  await Promise.all([voiceReady, whisperReady, modelsReady, listener.start()]);
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

let turn: Promise<void> | null = null;

async function respond(heardTiming: string): Promise<void> {
  glances.hold();
  let released = false;
  const releaseGlance = () => {
    if (released) return;
    released = true;
    glances.release();
  };
  let spoke = false;
  const timing = [heardTiming, `context ${context.size}`];
  try {
    const memory = context.prompt();
    console.log("thinking");
    const replyStarted = performance.now();
    let line = "";
    try {
      line = await firstSpokenSentence(config, memory, AbortSignal.timeout(60_000));
      timing.push(`reply ${elapsed(replyStarted)}`);
    } catch (error) {
      timing.push(`reply ${elapsed(replyStarted)} failed`);
      console.error(error instanceof Error ? error.message : error);
      return;
    }
    context.add("said", line);
    releaseGlance();
    console.log(`speaking: ${line}`);
    listener.pause();
    try {
      const synthesizeStarted = performance.now();
      let wav: Uint8Array | null = null;
      try {
        wav = await synthesize(config, line);
        timing.push(`synthesize ${elapsed(synthesizeStarted)}`);
        const effectStarted = performance.now();
        wav = await colorVoice(config, wav);
        timing.push(`effect ${elapsed(effectStarted)}`);
      } catch (error) {
        timing.push(`voice ${elapsed(synthesizeStarted)} failed`);
        console.error(error instanceof Error ? error.message : error);
        wav = null;
      }
      if (wav) {
        const playStarted = performance.now();
        try {
          await play(wav);
          timing.push(`play ${elapsed(playStarted)}`);
          spoke = true;
        } catch (error) {
          timing.push(`play ${elapsed(playStarted)} failed`);
          console.error(error instanceof Error ? error.message : error);
        }
      }
    } finally {
      if (spoke) await Bun.sleep(config.playbackTailMs);
      listener.resume();
    }
  } finally {
    releaseGlance();
    console.log(`timing: ${timing.join(", ")}`);
    console.log("listening");
  }
}

try {
  for await (const utterance of listener.utterances()) {
    if (stopping) break;
    camera.check();
    const audioMs = Math.round((utterance.length / config.sampleRate) * 1000);
    const recognizeStarted = performance.now();
    let transcript = "";
    try {
      transcript = await transcribe(config, utterance);
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
    turn = respond(heardTiming).finally(() => {
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
