import { getCharacter, type QuickLine } from "./characters.ts";
import { root } from "./paths.ts";

export type Config = {
  cameraDevice: string;
  micDevice: string;
  cameraPixelFormat: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  whisperBin: string;
  whisperModel: string;
  whisperPort: number;
  ollamaUrl: string;
  ollamaGlanceModel: string;
  ollamaReplyModel: string;
  character: string;
  voice: string;
  voiceSpeed: number;
  voicePitch: number;
  voiceEchoMs: number;
  voiceCrackle: number;
  delays: string[];
  quickLines: QuickLine[];
  roleFile: string;
  sampleRate: number;
  silenceMs: number;
  minSpeechMs: number;
  maxSpeechMs: number;
  levelThreshold: number;
  playbackTailMs: number;
};

const numberFields = [
  "frameWidth",
  "frameHeight",
  "frameRate",
  "whisperPort",
  "sampleRate",
  "silenceMs",
  "minSpeechMs",
  "maxSpeechMs",
  "levelThreshold",
  "playbackTailMs",
] as const;

const stringFields = [
  "cameraDevice",
  "micDevice",
  "cameraPixelFormat",
  "whisperBin",
  "whisperModel",
  "ollamaUrl",
  "ollamaGlanceModel",
  "ollamaReplyModel",
  "character",
] as const;

export function characterArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--character") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("Pass a name after --character");
      return value;
    }
    if (arg.startsWith("--character=")) {
      const value = arg.slice("--character=".length);
      if (!value) throw new Error("Pass a name with --character=name");
      return value;
    }
  }
  return null;
}

export async function loadConfig(argv: string[] = Bun.argv): Promise<Config> {
  const path = `${root}/config.json`;
  let raw: string;
  try {
    raw = await Bun.file(path).text();
  } catch {
    throw new Error(`Could not read ${path}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("config.json must be an object");
  }
  const record = parsed as Record<string, unknown>;
  for (const key of stringFields) {
    if (typeof record[key] !== "string") {
      throw new Error(`config.json ${key} must be a string`);
    }
  }
  for (const key of numberFields) {
    if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
      throw new Error(`config.json ${key} must be a number`);
    }
  }
  const chosen = characterArg(argv) ?? String(record.character);
  const character = getCharacter(chosen);
  const config = {
    ...(record as Config),
    character: chosen,
    voice: character.voice,
    voiceSpeed: character.voiceSpeed,
    voicePitch: character.voicePitch,
    voiceEchoMs: character.voiceEchoMs,
    voiceCrackle: character.voiceCrackle,
    delays: [...character.delays],
    quickLines: character.quickLines.map((line) => ({ ...line })),
    roleFile: character.roleFile,
  };
  if (config.levelThreshold <= 0 || config.levelThreshold >= 1) {
    throw new Error("config.json levelThreshold must be between 0 and 1");
  }
  if (config.sampleRate < 8000) {
    throw new Error("config.json sampleRate must be at least 8000");
  }
  return config;
}
