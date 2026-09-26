import { firstSpokenSentence, warmModels } from "./brain.ts";
import { firstSpokenChunk } from "./sentence.ts";
import { Camera } from "./camera.ts";
import { loadConfig } from "./config.ts";
import { ContextLog } from "./context.ts";
import { matchCanned, nextFill, prepareCues, sameUtterance, type Cues } from "./cues.ts";
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
console.log("starting whisper");
try {
  await startWhisper(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
console.log("loading voice, camera, and microphone");
let cues: Cues | null = null;
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

type Pending = {
  epoch: number;
  text: Promise<string>;
  line: Promise<string>;
  opening: Promise<Uint8Array | null>;
  rest: Promise<Uint8Array | null>;
  abort: AbortController;
};

let turn: Promise<void> | null = null;
let pending: Pending | null = null;
let guessGen = 0;
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

function currentCues(): Cues | null {
  return cues;
}

function livePending(): Pending | null {
  return pending;
}

function dropPending(): void {
  pending?.abort.abort();
  pending = null;
  guessGen += 1;
}

function renderCaught(text: string, signal: AbortSignal): Promise<Uint8Array | null> {
  if (!text || signal.aborted) return Promise.resolve(null);
  return renderVoice(config, text).catch((error: unknown) => {
    if (signal.aborted || isAbort(error)) return null;
    throw error;
  });
}

function beginFromText(epoch: number, heard: Promise<string>, abort: AbortController): Pending {
  let openingJob: Promise<Uint8Array | null> | null = null;
  const line = heard.then(async (text) => {
    if (abort.signal.aborted || !text || !cues) return "";
    const canned = matchCanned(cues.lines, text);
    if (canned) {
      openingJob = Promise.resolve(canned.wav);
      return canned.say;
    }
    return firstSpokenSentence(config, `${context.prompt()}\nheard: ${text}`, abort.signal, (now) => {
      if (openingJob || abort.signal.aborted) return;
      openingJob = renderCaught(now, abort.signal);
    }).catch((error: unknown) => {
      if (abort.signal.aborted || isAbort(error)) return "";
      throw error;
    });
  });
  const opening = line.then(async (spoken) => {
    if (abort.signal.aborted || !spoken) return null;
    if (!openingJob) {
      const chunk = firstSpokenChunk(spoken);
      openingJob = renderCaught(chunk.now, abort.signal);
    }
    return openingJob;
  });
  const rest = line.then(async (spoken) => {
    if (abort.signal.aborted || !spoken) return null;
    const chunk = firstSpokenChunk(spoken);
    if (!chunk.later) return null;
    await opening.catch(() => null);
    return renderCaught(chunk.later, abort.signal);
  });
  line.catch((error: unknown) => {
    if (!abort.signal.aborted) console.error(error instanceof Error ? error.message : error);
  });
  return { epoch, text: heard, line, opening, rest, abort };
}

function beginFromPcm(epoch: number, pcm: Int16Array): void {
  const gen = ++guessGen;
  const abort = new AbortController();
  const heard = transcribe(config, pcm).then((text) => (abort.signal.aborted ? "" : text));
  const next = beginFromText(epoch, heard, abort);
  if (guessGen !== gen) {
    abort.abort();
    return;
  }
  pending = next;
}

listener.onPartial = (epoch, pcm) => {
  if (turn || stopping || !cues || pending) return;
  beginFromPcm(epoch, pcm);
};

listener.onPreview = (epoch, pcm) => {
  if (turn || stopping || !cues) return;
  cancelFillTimer();
  fillTimer = setTimeout(() => {
    fillTimer = null;
    if (turn || stopping || !cues || breath || pending || Date.now() - humPlayedAt <= 4_000) return;
    fillIndex = nextFill(cues.fills.length, fillIndex);
    const fill = cues.fills[fillIndex];
    if (!fill) return;
    humPlayedAt = Date.now();
    listener.deafen();
    breath = startClip(fill);
  }, FILL_DELAY_MS);
  const gen = ++guessGen;
  void transcribe(config, pcm)
    .then(async (heard) => {
      if (turn || guessGen !== gen || !heard) return;
      const current = pending;
      if (current && current.epoch === epoch) {
        const early = await current.text;
        if (guessGen !== gen) return;
        if (sameUtterance(early, heard)) return;
        current.abort.abort();
      }
      const abort = new AbortController();
      pending = beginFromText(epoch, Promise.resolve(heard), abort);
    })
    .catch((error: unknown) => {
      if (!isAbort(error)) console.error(error instanceof Error ? error.message : error);
    });
};

listener.onPreviewCancel = () => {
  cancelFillTimer();
  stopBreath();
  dropPending();
};

async function respond(
  heardTiming: string,
  line: string,
  readyWav: Uint8Array | null,
  rest: Promise<Uint8Array | null> | null,
): Promise<void> {
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
        const chunk = firstSpokenChunk(line);
        wav = await renderVoice(config, chunk.now);
        if (chunk.later) rest = renderVoice(config, chunk.later).catch(() => null);
        timing.push(`voice ${elapsed(voiceStarted)}`);
      }
    } catch (error) {
      timing.push(`voice ${elapsed(voiceStarted)} failed`);
      console.error(error instanceof Error ? error.message : error);
      return;
    }
    listener.pause();
    try {
      const playStarted = performance.now();
      await play(wav);
      const restWav = rest ? await rest : null;
      if (restWav && restWav.byteLength > 0) await play(restWav);
      releaseGlance();
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
    const current = livePending();
    const early = current && current.epoch === utterance.epoch ? current : null;
    if (current && current !== early) dropPending();
    let transcript = "";
    try {
      transcript = await finalTranscript;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      console.log(`timing: audio ${audioMs}ms, recognize ${elapsed(recognizeStarted)} failed`);
      glances.release();
      continue;
    }
    const earlyText = early ? await early.text : "";
    const guessed = early && sameUtterance(earlyText, transcript) ? early : null;
    if (early && !guessed) {
      early.abort.abort();
      if (livePending() === early) pending = null;
      guessGen += 1;
    }
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
    const canned = guessed ? null : matchCanned(currentCues()?.lines ?? [], transcript);
    turn = (async () => {
      if (canned && canned.wav.byteLength > 0) {
        await respond(`${heardTiming}, quick`, canned.say, canned.wav, null);
        return;
      }
      let line = "";
      const replyStarted = performance.now();
      try {
        line = guessed ? await guessed.line : await firstSpokenSentence(config, context.prompt(), AbortSignal.timeout(60_000));
        if (!line) throw new Error("Ollama returned an empty reply");
        heardTiming = `${heardTiming}, reply ${elapsed(replyStarted)}`;
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        stopBreath();
        console.log(`timing: ${heardTiming}, reply ${elapsed(replyStarted)} failed`);
        glances.release();
        return;
      }
      const voiceStarted = performance.now();
      const opening = guessed ? await guessed.opening : null;
      if (opening) heardTiming = `${heardTiming}, voice ${elapsed(voiceStarted)}`;
      await respond(heardTiming, line, opening, guessed ? guessed.rest : null);
    })().finally(() => {
      turn = null;
      if (livePending() === early) pending = null;
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
