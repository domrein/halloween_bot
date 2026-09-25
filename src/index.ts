import { firstSpokenSentence, warmModels } from "./brain.ts";
import { Camera } from "./camera.ts";
import { loadConfig } from "./config.ts";
import { ContextLog } from "./context.ts";
import { matchCanned, nextFill, normalizeHeard, prepareCues, type Cues } from "./cues.ts";
import { Glances } from "./glance.ts";
import { Listener } from "./listen.ts";
import { preflight } from "./preflight.ts";
import { colorVoice, play, startClip, synthesize, warmVoice } from "./voice.ts";
import { startWhisper, stopWhisper, transcribe } from "./whisper.ts";

const config = await loadConfig();
const camera = new Camera(config);
const listener = new Listener(config);
const context = new ContextLog();
const glances = new Glances(config, camera, context);
listener.onSpeech = () => {
  if (!stopping) glances.hold();
};
listener.onSpeechCancel = () => glances.release();
listener.onUtteranceDrop = () => glances.release();

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
console.log("loading voice, whisper, camera, and microphone");
let cues: Cues | null = null;
const voiceReady = warmVoice().then(async () => {
  cues = await prepareCues(config);
});
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

type Guess = {
  epoch: number;
  text: string;
  cannedWav: Uint8Array | null;
  cannedSay: string | null;
  reply: Promise<string> | null;
  abort: AbortController;
};

let turn: Promise<void> | null = null;
let guess: Promise<Guess | null> | null = null;
let guessAbort: AbortController | null = null;
let breath: { stop: () => void; done: Promise<void> } | null = null;
let humPlayedAt = 0;
let fillIndex = -1;
let fillTimer: ReturnType<typeof setTimeout> | null = null;

const FILL_DELAY_MS = 450;

function cancelFillTimer(): void {
  if (!fillTimer) return;
  clearTimeout(fillTimer);
  fillTimer = null;
}

function stopBreath(): void {
  cancelFillTimer();
  breath?.stop();
  breath = null;
  listener.undeafen();
}

async function finishBreath(): Promise<void> {
  cancelFillTimer();
  const current = breath;
  if (!current) {
    listener.undeafen();
    return;
  }
  try {
    await current.done;
  } catch {
    // The clip was stopped because they started talking again.
  }
  if (breath === current) breath = null;
  listener.undeafen();
}

function currentGuess(): Promise<Guess | null> | null {
  return guess;
}

function currentCues(): Cues | null {
  return cues;
}

listener.onPreview = (epoch, pcm) => {
  if (turn || stopping || !cues) return;
  cancelFillTimer();
  fillTimer = setTimeout(() => {
    fillTimer = null;
    if (turn || stopping || !cues || breath || Date.now() - humPlayedAt <= 4_000) return;
    fillIndex = nextFill(cues.fills.length, fillIndex);
    const fill = cues.fills[fillIndex];
    if (!fill) return;
    humPlayedAt = Date.now();
    listener.deafen();
    breath = startClip(fill);
  }, FILL_DELAY_MS);
  const abort = new AbortController();
  guessAbort = abort;
  guess = (async () => {
    const text = await transcribe(config, pcm);
    if (abort.signal.aborted || !text) return null;
    const canned = matchCanned(cues!.lines, text);
    const reply = canned
      ? null
      : firstSpokenSentence(config, `${context.prompt()}\nheard: ${text}`, abort.signal).catch((error: unknown) => {
          if (abort.signal.aborted || isAbort(error)) return "";
          throw error;
        });
    return {
      epoch,
      text,
      cannedWav: canned?.wav ?? null,
      cannedSay: canned?.say ?? null,
      reply,
      abort,
    };
  })().catch((error: unknown) => {
    if (!abort.signal.aborted) console.error(error instanceof Error ? error.message : error);
    return null;
  });
};

listener.onPreviewCancel = () => {
  cancelFillTimer();
  stopBreath();
  guessAbort?.abort();
  guessAbort = null;
  guess = null;
};

async function respond(heardTiming: string, line: string, readyWav: Uint8Array | null): Promise<void> {
  let released = false;
  const releaseGlance = () => {
    if (released) return;
    released = true;
    glances.release();
  };
  let spoke = false;
  const timing = [heardTiming, `context ${context.size}`];
  try {
    console.log("thinking");
    context.add("said", line);
    console.log(`speaking: ${line}`);
    await finishBreath();
    const voiceStarted = performance.now();
    let wav = readyWav;
    try {
      if (!wav) {
        wav = await colorVoice(config, await synthesize(config, line));
        timing.push(`voice ${elapsed(voiceStarted)}`);
      }
    } catch (error) {
      timing.push(`voice ${elapsed(voiceStarted)} failed`);
      console.error(error instanceof Error ? error.message : error);
      return;
    }
    releaseGlance();
    listener.pause();
    try {
      const playStarted = performance.now();
      await play(wav);
      timing.push(`${readyWav ? "play cached" : "play"} ${elapsed(readyWav ? voiceStarted : playStarted)}`);
      spoke = true;
    } catch (error) {
      timing.push(`play ${elapsed(voiceStarted)} failed`);
      console.error(error instanceof Error ? error.message : error);
    } finally {
      listener.resume();
      console.log("listening");
      if (spoke && config.playbackTailMs > 0) {
        listener.deafen();
        await Bun.sleep(config.playbackTailMs);
        listener.undeafen();
      }
    }
  } finally {
    releaseGlance();
    console.log(`timing: ${timing.join(", ")}`);
  }
}

try {
  for await (const utterance of listener.utterances()) {
    if (stopping) break;
    camera.check();
    const audioMs = Math.round((utterance.pcm.length / config.sampleRate) * 1000);
    const recognizeStarted = performance.now();
    const finalTranscript = transcribe(config, utterance.pcm);
    const pending = currentGuess();
    const early = pending ? await pending : null;
    if (early && early.epoch !== utterance.epoch) early.abort.abort();
    let transcript = "";
    try {
      transcript = await finalTranscript;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      console.log(`timing: audio ${audioMs}ms, recognize ${elapsed(recognizeStarted)} failed`);
      glances.release();
      continue;
    }
    const earlyGuess = early && early.epoch === utterance.epoch ? early : null;
    const sameWords = earlyGuess !== null && normalizeHeard(earlyGuess.text) === normalizeHeard(transcript);
    if (earlyGuess && !sameWords) earlyGuess.abort.abort();
    const guessed = sameWords ? earlyGuess : null;
    let heardTiming = `audio ${audioMs}ms, recognize ${elapsed(recognizeStarted)}${guessed ? " early" : ""}`;
    console.log(`heard: ${transcript || "(silence)"}`);
    if (!transcript) {
      await finishBreath();
      console.log(`timing: ${heardTiming}`);
      glances.release();
      continue;
    }
    context.add("heard", transcript);
    if (turn) {
      stopBreath();
      console.log("noted");
      console.log(`timing: ${heardTiming}`);
      glances.release();
      continue;
    }
    const canned = guessed?.cannedWav ? guessed : matchCanned(currentCues()?.lines ?? [], transcript);
    turn = (async () => {
      if (guessed?.cannedWav && guessed.cannedSay) {
        await respond(heardTiming, guessed.cannedSay, guessed.cannedWav);
        return;
      }
      if (canned && "wav" in canned && canned.wav.byteLength > 0) {
        await respond(`${heardTiming}, quick`, canned.say, canned.wav);
        return;
      }
      let line = "";
      const replyStarted = performance.now();
      try {
        line = guessed?.reply
          ? await guessed.reply
          : await firstSpokenSentence(config, context.prompt(), AbortSignal.timeout(60_000));
        if (!line) throw new Error("Ollama returned an empty reply");
        heardTiming = `${heardTiming}, reply ${elapsed(replyStarted)}`;
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        stopBreath();
        console.log(`timing: ${heardTiming}, reply ${elapsed(replyStarted)} failed`);
        glances.release();
        return;
      }
      await respond(heardTiming, line, null);
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
