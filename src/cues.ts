import type { Config } from "./config.ts";
import { colorVoice, synthesize } from "./voice.ts";

import type { QuickLine } from "./characters.ts";

export type CannedLine = QuickLine & { wav: Uint8Array };

export type Cues = {
  fills: Uint8Array[];
  lines: CannedLine[];
};

/** The early transcript is the same phrase, or a slightly shorter version of it. */
export function sameUtterance(early: string, final: string): boolean {
  const a = normalizeHeard(early);
  const b = normalizeHeard(final);
  if (!a || !b) return false;
  if (a === b) return true;
  if (!b.startsWith(`${a} `) || a.split(" ").length < 3) return false;
  const extra = b.slice(a.length).trim().split(" ").filter(Boolean);
  return extra.length <= 2;
}

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
  for (const line of config.delays) {
    fills.push(await colorVoice(config, await synthesize(config, line)));
  }
  const lines: CannedLine[] = [];
  for (const pattern of config.quickLines) {
    lines.push({ ...pattern, wav: await colorVoice(config, await synthesize(config, pattern.say)) });
  }
  return { fills, lines };
}
