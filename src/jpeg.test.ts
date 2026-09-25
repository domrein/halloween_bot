import { expect, test } from "bun:test";
import { takeJpegs } from "./jpeg.ts";

test("extracts one jpeg and keeps a trailing partial", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const extra = Uint8Array.from([9, 9, 0xff]);
  const input = new Uint8Array(jpeg.length + extra.length);
  input.set(jpeg, 0);
  input.set(extra, jpeg.length);

  const { frames, rest } = takeJpegs(input);
  expect(frames).toHaveLength(1);
  expect(frames[0]).toEqual(jpeg);
  expect(rest).toEqual(Uint8Array.from([0xff]));
});

test("joins a jpeg split across chunks", () => {
  const jpeg = Uint8Array.from([0, 0xff, 0xd8, 4, 5, 0xff, 0xd9, 7]);
  const first = takeJpegs(jpeg.slice(0, 4));
  expect(first.frames).toHaveLength(0);
  const combined = new Uint8Array(first.rest.length + jpeg.length - 4);
  combined.set(first.rest, 0);
  combined.set(jpeg.slice(4), first.rest.length);
  const second = takeJpegs(combined);
  expect(second.frames).toHaveLength(1);
  expect(second.frames[0]).toEqual(Uint8Array.from([0xff, 0xd8, 4, 5, 0xff, 0xd9]));
  expect(second.rest).toEqual(new Uint8Array());
});
