import type { Config } from "./config.ts";
import { colorVoice, synthesize } from "./voice.ts";
import { encodeWav } from "./wav.ts";

type Pattern = { test: RegExp; say: string };

const DELAY_LINES = ["Well.", "Let me think.", "Hmmmmm."];

const PATTERNS: Pattern[] = [
  { test: /^(?:hello|hi|hey)(?: there)?$/, say: "Hi there!" },
  { test: /^(?:trick|drink) or treat$/, say: "Happy Halloween!" },
  { test: /^how are you(?: doing)?$/, say: "I'm hauntingly well!" },
];

export type CannedLine = Pattern & { wav: Uint8Array };

export type Cues = {
  fills: Uint8Array[];
  lines: CannedLine[];
};

export function normalizeHeard(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchCanned(lines: CannedLine[], transcript: string): CannedLine | null {
  const heard = normalizeHeard(transcript);
  return lines.find((line) => line.test.test(heard)) ?? null;
}

export function nextFill(count: number, last: number): number {
  if (count <= 0) return 0;
  return (last + 1) % count;
}

export async function prepareCues(config: Config): Promise<Cues> {
  console.log("preparing quick lines");
  const fills: Uint8Array[] = [];
  for (const durationMs of [1200, 2000]) {
    fills.push(await colorVoice(config, humWav(durationMs)));
  }
  for (const line of DELAY_LINES) {
    fills.push(await colorVoice(config, await synthesize(config, line)));
  }
  const lines: CannedLine[] = [];
  for (const pattern of PATTERNS) {
    lines.push({ ...pattern, wav: await colorVoice(config, await synthesize(config, pattern.say)) });
  }
  return { fills, lines };
}

function humWav(durationMs: number, sampleRate = 24000): Uint8Array {
  const total = Math.floor((sampleRate * durationMs) / 1000);
  const pcm = new Int16Array(total);
  const freq = 92;
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, i / (sampleRate * 0.12));
    const fadeOut = Math.min(1, (total - i) / (sampleRate * 0.55));
    const env = Math.min(fadeIn, fadeOut);
    const vibrato = 1 + 0.012 * Math.sin(2 * Math.PI * 4.2 * t);
    const tone =
      Math.sin(2 * Math.PI * freq * vibrato * t) * 0.62 +
      Math.sin(2 * Math.PI * freq * 2 * vibrato * t) * 0.08;
    pcm[i] = Math.round(tone * env * 26000);
  }
  return encodeWav(pcm, sampleRate);
}
