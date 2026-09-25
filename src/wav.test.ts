import { expect, test } from "bun:test";
import { decodeS16le, encodeWav } from "./wav.ts";

test("wav header describes mono 16-bit pcm", () => {
  const pcm = Int16Array.from([1, -2, 300]);
  const wav = encodeWav(pcm, 16000);
  expect(wav.byteLength).toBe(44 + 6);
  expect(text(wav, 0, 4)).toBe("RIFF");
  expect(text(wav, 8, 4)).toBe("WAVE");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(6);
  expect(view.getInt16(44, true)).toBe(1);
  expect(view.getInt16(46, true)).toBe(-2);
  expect(view.getInt16(48, true)).toBe(300);
});

test("s16le decode keeps a dangling byte", () => {
  const bytes = Uint8Array.from([1, 0, 2, 0, 3]);
  const { pcm, rest } = decodeS16le(bytes);
  expect(Array.from(pcm)).toEqual([1, 2]);
  expect(rest).toEqual(Uint8Array.from([3]));
});

function text(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(offset, offset + length));
}
