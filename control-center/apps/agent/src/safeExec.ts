import { execFile } from "node:child_process";

export type FixedExecutable = "git" | "docker";

const allowed = new Set<FixedExecutable>(["git", "docker"]);

export function execFixed(command: FixedExecutable, args: string[], cwd?: string, timeoutMs = 8000) {
  if (!allowed.has(command)) throw new Error(`Executable not allowed: ${command}`);
  for (const arg of args) {
    if (/[;&|`$<>]/.test(arg)) throw new Error(`Unsafe argument: ${arg}`);
  }
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, shell: false }, (error, stdout, stderr) => {
      resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0 });
    });
  });
}
