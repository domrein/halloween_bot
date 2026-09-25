import { expect, test } from "bun:test";
import { firstSentence } from "./sentence.ts";

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
