import { expect, test } from "bun:test";
import { UtteranceDetector, type VadOptions } from "./vad.ts";

const chunkSamples = 1600;

function tone(amp: number): Int16Array {
  const chunk = new Int16Array(chunkSamples);
  chunk.fill(Math.round(amp * 32767));
  return chunk;
}

function detector(overrides: Partial<VadOptions> = {}): UtteranceDetector {
  return new UtteranceDetector({
    sampleRate: 16000,
    silenceMs: 700,
    minSpeechMs: 400,
    maxSpeechMs: 8000,
    levelThreshold: 0.05,
    preRollMs: 300,
    ...overrides,
  });
}

test("quiet audio never becomes an utterance", () => {
  const vad = detector();
  for (let i = 0; i < 20; i++) expect(vad.push(tone(0.001))).toBeNull();
});

test("speech followed by silence is returned once", () => {
  const vad = detector();
  for (let i = 0; i < 5; i++) expect(vad.push(tone(0.001))).toBeNull();
  for (let i = 0; i < 4; i++) expect(vad.push(tone(0.2))).toBeNull();
  let utterance: Int16Array | null = null;
  for (let i = 0; i < 8 && !utterance; i++) utterance = vad.push(tone(0.001));
  expect(utterance).not.toBeNull();
  expect(utterance!.length).toBeGreaterThan(4 * chunkSamples);
});

test("preview waits until the last word has landed", () => {
  const previews: number[] = [];
  const vad = detector({
    previewDelayMs: 300,
    onPreview: () => previews.push(1),
  });
  for (let i = 0; i < 4; i++) vad.push(tone(0.2));
  vad.push(tone(0.001));
  expect(previews).toHaveLength(0);
  for (let i = 0; i < 3; i++) vad.push(tone(0.001));
  expect(previews).toHaveLength(1);
});

test("preview fires once when speech goes quiet", () => {
  const previews: number[] = [];
  const vad = detector({
    onPreview: (_pcm, epoch) => previews.push(epoch),
  });
  for (let i = 0; i < 4; i++) vad.push(tone(0.2));
  for (let i = 0; i < 8; i++) vad.push(tone(0.001));
  expect(previews).toHaveLength(1);
});

test("speech start is signaled once per utterance", () => {
  let starts = 0;
  const vad = detector({ onSpeech: () => starts++ });
  vad.push(tone(0.2));
  expect(starts).toBe(1);
  vad.push(tone(0.001));
  vad.push(tone(0.2));
  expect(starts).toBe(1);
});

test("a short blip releases the speech hold", () => {
  let cancels = 0;
  const vad = detector({ silenceMs: 200, onSpeechCancel: () => cancels++ });
  vad.push(tone(0.2));
  vad.push(tone(0.2));
  expect(vad.push(tone(0.001))).toBeNull();
  expect(vad.push(tone(0.001))).toBeNull();
  expect(cancels).toBe(1);
});

test("pausing mid-speech releases the hold", () => {
  let cancels = 0;
  const vad = detector({ onSpeechCancel: () => cancels++ });
  vad.push(tone(0.2));
  vad.reset(true);
  expect(cancels).toBe(1);
  vad.reset(true);
  expect(cancels).toBe(1);
});

test("a short blip is dropped", () => {
  const vad = detector();
  expect(vad.push(tone(0.2))).toBeNull();
  expect(vad.push(tone(0.2))).toBeNull();
  let emitted = false;
  for (let i = 0; i < 10; i++) {
    if (vad.push(tone(0.001))) emitted = true;
  }
  expect(emitted).toBe(false);
});

test("long speech is cut at the max length", () => {
  const vad = detector({ maxSpeechMs: 500, minSpeechMs: 200, preRollMs: 0 });
  let utterance: Int16Array | null = null;
  for (let i = 0; i < 10 && !utterance; i++) utterance = vad.push(tone(0.2));
  expect(utterance).not.toBeNull();
  expect(utterance!.length).toBeGreaterThanOrEqual(5 * chunkSamples);
});
