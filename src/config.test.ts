import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

test("config.json loads", async () => {
  const config = await loadConfig();
  expect(config.sampleRate).toBe(16000);
  expect(config.voice.length).toBeGreaterThan(0);
  expect(config.levelThreshold).toBeGreaterThan(0);
});
