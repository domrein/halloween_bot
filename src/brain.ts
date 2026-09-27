import type { Config } from "./config.ts";
import { root } from "./paths.ts";
import { firstSentence, unfinishedLine } from "./sentence.ts";

const SPEAK_RULE = "Say only one short sentence, the words to speak aloud. No quotation marks, no stage directions, no emoji, no labels.";

const SCENE_PROMPT =
  "Look at this porch camera photo. Reply with one short phrase: child or adult, the costume, and what they are holding. If the photo is dark, empty, or unclear, reply with exactly: nothing";

export async function warmModels(config: Config): Promise<void> {
  console.log("warming reply model");
  await warmModel(config, config.ollamaReplyModel, 1024);
  console.log("warming glance model");
  await warmModel(config, config.ollamaGlanceModel, 4096);
}

async function warmModel(config: Config, model: string, numCtx: number): Promise<void> {
  await chat(config, model, AbortSignal.timeout(120_000), {
    stream: true,
    messages: [{ role: "user", content: "Say hi." }],
    options: { temperature: 0, num_predict: 1, num_ctx: numCtx },
  });
}

export async function describeScene(config: Config, frame: Uint8Array, signal: AbortSignal): Promise<string> {
  const content = await chat(config, config.ollamaGlanceModel, signal, {
    stream: true,
    messages: [{ role: "user", content: SCENE_PROMPT, images: [Buffer.from(frame).toString("base64")] }],
    options: { temperature: 0.2, num_predict: 40, num_ctx: 4096 },
  });
  const phrase = unfinishedLine(content).replace(/[.!?]+$/g, "").trim();
  if (!phrase || /^nothing\b/i.test(phrase)) return "";
  return phrase;
}

export async function firstSpokenSentence(config: Config, memory: string, signal: AbortSignal): Promise<string> {
  const character = await Bun.file(`${root}/${config.roleFile}`).text();
  const content = await chat(config, config.ollamaReplyModel, signal, {
    stream: true,
    stopAtSentence: true,
    messages: [
      { role: "system", content: `${character.trim()}\n\n${SPEAK_RULE}` },
      {
        role: "user",
        content: `Events in chronological order, oldest first:\n${memory}\n\nReply to the last heard line. Do not repeat it. One short sentence.`,
      },
    ],
    options: { temperature: 0.4, num_predict: 40, num_ctx: 1024 },
  });
  const sentence = firstSentence(content) ?? unfinishedLine(content);
  if (!sentence) throw new Error("Ollama returned an empty reply");
  return sentence;
}

export async function reply(config: Config, transcript: string, frame: Uint8Array | null): Promise<string> {
  const signal = AbortSignal.timeout(45_000);
  const glance = frame ? await describeScene(config, frame, signal) : "";
  const memory = [glance ? `seen: ${glance}` : "", `heard: ${transcript}`].filter(Boolean).join("\n");
  return firstSpokenSentence(config, memory, signal);
}

type ChatMessage = { role: string; content: string; images?: string[] };

async function chat(
  config: Config,
  model: string,
  signal: AbortSignal,
  request: {
    stream: true;
    stopAtSentence?: boolean;
    messages: ChatMessage[];
    options: { temperature: number; num_predict: number; num_ctx: number };
  },
): Promise<string> {
  const response = await fetch(`${config.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      keep_alive: "30m",
      messages: request.messages,
      options: request.options,
    }),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw.slice(0, 400) || `Ollama returned ${response.status}`);
  }
  if (!response.body) throw new Error("Ollama returned an empty stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = readChunk(line);
        if (chunk.error) throw new Error(chunk.error);
        content += chunk.text;
        if (request.stopAtSentence && firstSentence(content)) return content;
        if (chunk.done) return content;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return content;
}

function readChunk(line: string): { text: string; done: boolean; error?: string } {
  const trimmed = line.trim();
  if (!trimmed) return { text: "", done: false };
  let body: { message?: { content?: string }; error?: string; done?: boolean };
  try {
    body = JSON.parse(trimmed) as { message?: { content?: string }; error?: string; done?: boolean };
  } catch {
    return { text: "", done: false };
  }
  if (body.error) return { text: "", done: true, error: body.error };
  return { text: body.message?.content ?? "", done: body.done === true };
}
