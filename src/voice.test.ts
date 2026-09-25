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
  expect(filter).not.toContain("acrusher");
});

test("makes the skeleton strain to hold a note", () => {
  const filter = voiceFilter(24000, 1, 0, 0.45);
  expect(filter).toContain("highpass=f=160");
  expect(filter).toContain("vibrato=f=5.5:d=0.62");
  expect(filter).toContain("tremolo=f=6:d=0.28");
  expect(filter).toContain("crystalizer=i=2.5");
});
