/** Pull complete JPEG frames out of an ffmpeg mjpeg pipe. Incomplete bytes come back as `rest`. */
export function takeJpegs(input: Uint8Array) {
  const frames: Uint8Array[] = [];
  let start = -1;

  for (let i = 0; i < input.length - 1; i++) {
    if (input[i] !== 0xff) continue;
    const marker = input[i + 1];
    if (marker === 0xd8) {
      start = i;
      i++;
      continue;
    }
    if (marker === 0xd9 && start >= 0) {
      frames.push(input.slice(start, i + 2));
      start = -1;
      i++;
    }
  }

  const rest =
    start >= 0
      ? input.slice(start)
      : input.length > 0 && input[input.length - 1] === 0xff
        ? input.slice(input.length - 1)
        : new Uint8Array();
  return { frames: frames.map(copyBytes), rest: copyBytes(rest) };
}

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
