import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

test("config.json loads", async () => {
  const config = await loadConfig();
  expect(config.sampleRate).toBe(16000);
  expect(config.character).toBe("ghost");
  expect(config.voice).toBe("bm_george");
  expect(config.delays.length).toBeGreaterThan(0);
  expect(config.roleFile).toBe("prompts/ghost.md");
  expect(config.levelThreshold).toBeGreaterThan(0);
});
