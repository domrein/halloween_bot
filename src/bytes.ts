export function concatBytes(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function followText(stream: ReadableStream<Uint8Array> | number | null | undefined): {
  current: () => string;
  finished: Promise<string>;
} {
  if (!stream || typeof stream === "number") {
    return { current: () => "", finished: Promise.resolve("") };
  }
  let text = "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const finished = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      text += decoder.decode(value, { stream: true });
      if (text.length > 12_000) text = text.slice(-12_000);
    }
    text = text.trim();
    return text;
  })();
  return { current: () => text.trim(), finished };
}

export function pipeText(stream: ReadableStream<Uint8Array> | number | null | undefined): Promise<string> {
  return followText(stream).finished;
}

