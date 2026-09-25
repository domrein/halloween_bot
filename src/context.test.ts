import { expect, test } from "bun:test";
import { ContextLog } from "./context.ts";

test("keeps glances and dialogue in order", () => {
  const log = new ContextLog();
  log.add("seen", "a child in a pumpkin costume");
  log.add("heard", "trick or treat");
  log.add("said", "Happy Halloween!");
  log.add("seen", "nothing visible");
  expect(log.prompt()).toBe(
    [
      "seen: a child in a pumpkin costume",
      "heard: trick or treat",
      "said: Happy Halloween!",
      "seen: nothing visible",
    ].join("\n"),
  );
  expect(log.size).toBe(4);
});

test("drops events past fifty", () => {
  const log = new ContextLog();
  for (let i = 0; i < 55; i++) log.add(i % 2 === 0 ? "seen" : "heard", `line ${i}`);
  expect(log.size).toBe(50);
  expect(log.prompt().startsWith("heard: line 5")).toBe(true);
  expect(log.prompt().endsWith("seen: line 54")).toBe(true);
});
