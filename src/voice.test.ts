import { expect, test } from "bun:test";
import { voiceFilter } from "./voice.ts";

test("skips ffmpeg when the voice is left alone", () => {
  expect(voiceFilter(24000, 1, 0)).toBeNull();
});

test("lowers pitch and restores the length", () => {
  const filter = voiceFilter(24000, 0.78, 120);
  expect(filter).toContain("asetrate=18720");
  expect(filter).toContain("atempo=1.2821");
  expect(filter).toContain("aecho=0.7:0.92:120|264:0.5|0.32");
});
