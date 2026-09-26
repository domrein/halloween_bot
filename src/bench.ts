import { firstSpokenSentence, warmModels } from "./brain.ts";
import { loadConfig } from "./config.ts";
import { firstSpokenChunk } from "./sentence.ts";
import { openVoice, timedVoice } from "./voice.ts";
import type { KokoroTTS } from "kokoro-js";
import type { Config } from "./config.ts";

const LINES = [
  "Testing 123, indeed.",
  "Indeed, a most curious sequence.",
  "A sequence, indeed, but what hypothesis might explain its nature?",
  "The apparatus is functioning splendidly.",
  "Good evening, I observe you.",
];

const HEARD = ["Testing 123.", "Testing one two three four", "Why is it curious?"];

const argv = ["bun", "src/bench.ts", "--character=scientist", ...process.argv.slice(2)];
const config = await loadConfig(argv);
const devices = devicesFromArgv(process.argv.slice(2));

console.log(`benchmark character ${config.character} (${config.voice})`);
console.log("each line is new. a repeated line is reported separately and is not the score.");

const voiceScores: Record<string, { full: number; chunk: number }> = {};
for (const device of devices) {
  console.log(`\nvoice ${device === "cpu" ? "fp16 cpu" : device}`);
  const tts = await openVoice(device);
  const full: number[] = [];
  const chunk: number[] = [];
  for (const line of LINES) {
    const whole = await timeLine(config, tts, line);
    full.push(whole.total);
    const piece = firstSpokenChunk(line);
    if (!piece.later) {
      chunk.push(whole.total);
      console.log(
        `  full ${Math.round(whole.total)}ms (synth ${Math.round(whole.synthesizeMs)} color ${Math.round(whole.colorMs)}) ${line}`,
      );
      continue;
    }
    const opening = await timeLine(config, tts, piece.now);
    chunk.push(opening.total);
    console.log(
      `  full ${Math.round(whole.total)}ms chunk ${Math.round(opening.total)}ms "${piece.now}" | ${line}`,
    );
  }
  const again = await timeLine(config, tts, LINES[0]!);
  console.log(`  repeat ${Math.round(again.total)}ms (same line again, not the live case) ${LINES[0]}`);
  voiceScores[device] = { full: mean(full), chunk: mean(chunk) };
  console.log(`  mean new line ${Math.round(mean(full))}ms, mean opening ${Math.round(mean(chunk))}ms`);
}

console.log("\nreply");
await warmModels(config);
const replies: number[] = [];
for (const heard of HEARD) {
  const started = performance.now();
  const line = await firstSpokenSentence(config, `heard: ${heard}`, AbortSignal.timeout(60_000));
  const ms = performance.now() - started;
  replies.push(ms);
  console.log(`  reply ${Math.round(ms)}ms heard "${heard}" -> ${line}`);
}
const replyMean = mean(replies);
console.log(`  mean reply ${Math.round(replyMean)}ms`);

const silence = config.silenceMs;
const speechMs = 1150;
const partialAt = 700;
const head = speechMs - partialAt;
console.log("\ngap from the last speech sample to the answer starting");
console.log(
  `silence ${silence}ms. if a snapshot ${partialAt}ms into a ${speechMs}ms phrase still matches, the reply has a ${head}ms head start.`,
);
for (const device of devices) {
  const score = voiceScores[device];
  if (!score) continue;
  const serial = silence + replyMean + score.full;
  const early = Math.max(silence, Math.max(0, replyMean - head) + score.chunk);
  console.log(
    `  ${device} serial ${Math.round(serial)}ms, early-partial ${Math.round(early)}ms (new line ${Math.round(score.full)}ms, opening ${Math.round(score.chunk)}ms)`,
  );
}

function devicesFromArgv(args: string[]): Array<"cpu" | "coreml"> {
  const picked = args.find((arg) => arg === "cpu" || arg === "coreml");
  if (picked === "cpu" || picked === "coreml") return [picked];
  return ["cpu"];
}

async function timeLine(config: Config, tts: KokoroTTS, text: string) {
  const timed = await timedVoice(config, tts, text);
  return { ...timed, total: timed.synthesizeMs + timed.colorMs };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
