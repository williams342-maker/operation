import { execFile } from "node:child_process";

export type FixedExecutable = "git" | "docker" | "nginx";
export const COMMAND_TIMEOUT_MS = 8_000;
export const COMMAND_STDOUT_MAX_BYTES = 16 * 1024;
export const COMMAND_STDERR_MAX_BYTES = 16 * 1024;
export type ExecResult = { stdout: string; stderr: string; code: number | null; errorCategory?: "timeout" | "output_limit" | "unavailable" | "exit_failure" };

const allowed = new Set<FixedExecutable>(["git", "docker", "nginx"]);

function runBounded(command: string, args: string[], cwd: string | undefined, timeoutMs: number) {
  return new Promise<ExecResult>((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: Math.min(COMMAND_STDOUT_MAX_BYTES, COMMAND_STDERR_MAX_BYTES), windowsHide: true, shell: false }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: 0 });
      const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
      const errorCategory = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output_limit" : failure.killed || failure.signal === "SIGTERM" ? "timeout" : failure.code === "ENOENT" ? "unavailable" : "exit_failure";
      resolve({ stdout: "", stderr: "", code: typeof failure.code === "number" ? failure.code : 1, errorCategory });
    });
  });
}

export function execFixed(command: FixedExecutable, args: string[], cwd?: string, timeoutMs = COMMAND_TIMEOUT_MS) {
  if (!allowed.has(command)) throw new Error(`Executable not allowed: ${command}`);
  for (const arg of args) {
    if (/[;&|`$<>]/.test(arg)) throw new Error(`Unsafe argument: ${arg}`);
  }
  return runBounded(command, args, cwd, timeoutMs);
}

export function execNodeForTest(source: string, timeoutMs = COMMAND_TIMEOUT_MS) {
  if (process.env.NODE_ENV !== "test") throw new Error("Test process runner is disabled");
  return runBounded(process.execPath, ["-e", source], undefined, timeoutMs);
}
