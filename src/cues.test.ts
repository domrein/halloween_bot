import { expect, test } from "bun:test";
import { matchCanned, nextFill, normalizeHeard, type CannedLine } from "./cues.ts";

const lines: CannedLine[] = [
  { test: /^(?:hello|hi|hey)(?: there)?$/, say: "Hi there!", wav: new Uint8Array() },
  { test: /^(?:trick|drink) or treat$/, say: "Happy Halloween!", wav: new Uint8Array() },
  { test: /^how are you(?: doing)?$/, say: "I'm hauntingly well!", wav: new Uint8Array() },
];

test("matches the lines heard all night", () => {
  expect(matchCanned(lines, "Hello there.")?.say).toBe("Hi there!");
  expect(matchCanned(lines, "Drink or treat!")?.say).toBe("Happy Halloween!");
  expect(matchCanned(lines, "How are you doing?")?.say).toBe("I'm hauntingly well!");
});

test("rotates delay sounds without repeating the last one", () => {
  expect(nextFill(5, -1)).toBe(0);
  expect(nextFill(5, 0)).toBe(1);
  expect(nextFill(5, 4)).toBe(0);
});

test("leaves real questions for the model", () => {
  expect(matchCanned(lines, "Why would you say hello when I say how are you doing?")).toBeNull();
  expect(normalizeHeard("Hello, there!")).toBe("hello there");
});
