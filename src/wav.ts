export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return new Uint8Array(buffer);
}

export function decodeS16le(bytes: Uint8Array) {
  const even = bytes.length - (bytes.length % 2);
  const pcm = new Int16Array(even / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, even);
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true);
  const rest = new Uint8Array(bytes.length - even);
  rest.set(bytes.subarray(even));
  return { pcm, rest };
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}
