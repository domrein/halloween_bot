export function stopProcess(proc: Bun.Subprocess | null): void {
  if (!proc || proc.exitCode !== null) return;
  proc.kill();
  const timer = setTimeout(() => {
    if (proc.exitCode === null) proc.kill(9);
  }, 400);
  void proc.exited.finally(() => clearTimeout(timer));
}

export function ffmpegFailure(text: string): string | null {
  if (!text) return null;
  if (
    /not supported|Error opening|Permission denied|not authorized|Operation not permitted|Device not configured|Input\/output error/i.test(
      text,
    )
  ) {
    return text;
  }
  return null;
}
