import { expect, test } from "bun:test";
import { voiceFilter } from "./voice.ts";

test("skips ffmpeg when the voice is left alone", () => {
  expect(voiceFilter(24000, 1, 0)).toBeNull();
});

test("lowers pitch and restores the length", () => {
  const filter = voiceFilter(24000, 0.86, 55);
  expect(filter).toContain("asetrate=20640");
  expect(filter).toContain("atempo=1.1628");
  expect(filter).toContain("aecho=0.8:0.88:55:0.35");
});
