import { join } from "node:path";

export const root = join(import.meta.dir, "..");

export function projectPath(path: string): string {
  if (path.startsWith("/")) return path;
  return join(root, path);
}
