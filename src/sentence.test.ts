import { expect, test } from "bun:test";
import { firstSentence, firstSpokenChunk } from "./sentence.ts";

test("waits until a sentence ends", () => {
  expect(firstSentence("Happy Halloween")).toBeNull();
});

test("keeps only the first sentence", () => {
  expect(firstSentence("Happy Halloween! Come closer.")).toBe("Happy Halloween!");
  expect(firstSentence("Well hello there. I see you.")).toBe("Well hello there.");
});

test("drops stage directions", () => {
  expect(firstSentence("*waves* Boo!")).toBe("Boo!");
});

test("speaks a short line in one piece", () => {
  expect(firstSpokenChunk("Testing 123, indeed.")).toEqual({ now: "Testing 123, indeed.", later: "" });
});

test("starts a long line at the first usable clause", () => {
  expect(firstSpokenChunk("A sequence, indeed, but what hypothesis might explain its nature?")).toEqual({
    now: "A sequence, indeed, but what",
    later: "hypothesis might explain its nature?",
  });
});
