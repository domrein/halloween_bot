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
  voice: string;
  voiceSpeed: number;
  voicePitch: number;
  voiceEchoMs: number;
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
  "voiceSpeed",
  "voicePitch",
  "voiceEchoMs",
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
  "voice",
] as const;

export async function loadConfig(): Promise<Config> {
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
  const config = record as Config;
  if (config.levelThreshold <= 0 || config.levelThreshold >= 1) {
    throw new Error("config.json levelThreshold must be between 0 and 1");
  }
  if (config.sampleRate < 8000) {
    throw new Error("config.json sampleRate must be at least 8000");
  }
  return config;
}
