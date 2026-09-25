import type { Config } from "./config.ts";
import { projectPath } from "./paths.ts";

export async function preflight(config: Config): Promise<void> {
  const problems: string[] = [];

  if (config.whisperBin.includes("/")) {
    if (!(await Bun.file(config.whisperBin).exists())) {
      problems.push(`Whisper binary not found at ${config.whisperBin}.`);
    }
  } else if (!Bun.which(config.whisperBin)) {
    problems.push(`Missing ${config.whisperBin}. Install it with: brew install whisper-cpp`);
  }

  const modelPath = projectPath(config.whisperModel);
  if (!(await Bun.file(modelPath).exists())) {
    problems.push(`Whisper model not found at ${modelPath}. See the README for the download.`);
  }

  try {
    const response = await fetch(`${config.ollamaUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      problems.push(`Ollama returned ${response.status} from ${config.ollamaUrl}.`);
    } else {
      const body = (await response.json()) as { models?: { name?: string }[] };
      const names = (body.models ?? []).map((model) => model.name).filter((name): name is string => !!name);
      for (const model of [config.ollamaGlanceModel, config.ollamaReplyModel]) {
        if (!names.some((name) => name === model || name.startsWith(`${model}-`))) {
          problems.push(`Ollama does not have ${model}. Run: ollama pull ${model}`);
        }
      }
    }
  } catch {
    problems.push(`Ollama is not running at ${config.ollamaUrl}. Start it with: brew services start ollama`);
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));
}
