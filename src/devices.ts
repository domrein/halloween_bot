import { pipeText } from "./bytes.ts";

const proc = Bun.spawn(
  ["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
  { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
);
const stderr = await pipeText(proc.stderr);
const stdout = await pipeText(proc.stdout);
await proc.exited;
const text = [stderr, stdout]
  .filter(Boolean)
  .join("\n")
  .split("\n")
  .map((line) => line.replace(/^\[[^\]]+\]\s*/, ""))
  .filter((line) => line.startsWith("AVFoundation") || /^\[\d+\]/.test(line))
  .join("\n");
console.log(text || "ffmpeg printed no devices");
console.log("\nPut a device name or its bracketed index in config.json as cameraDevice or micDevice.");
console.log("Names stay put when other devices show up. Indexes do not.");
