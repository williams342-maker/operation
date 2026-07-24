import { spawn, type ChildProcess } from "node:child_process";

export type FixedExecutable = "git" | "docker" | "nginx";
export const COMMAND_TIMEOUT_MS = 8_000;
export const COMMAND_STDOUT_MAX_BYTES = 16 * 1024;
export const COMMAND_STDERR_MAX_BYTES = 16 * 1024;
export type ExecResult = { stdout: string; stderr: string; code: number | null; errorCategory?: "timeout" | "output_limit" | "unavailable" | "exit_failure" };

const allowed = new Set<FixedExecutable>(["git", "docker", "nginx"]);

function terminateTree(child: ChildProcess) {
  if (child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* best effort */ }
  }
}

function forceTerminateTree(child: ChildProcess) {
  if (child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* best effort */ }
  }
}

function runBounded(command: string, args: string[], cwd: string | undefined, timeoutMs: number) {
  return new Promise<ExecResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let outputLimited = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const child = spawn(command, args, { cwd, detached: process.platform !== "win32", windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => { timedOut = true; terminateTree(child); }, timeoutMs);
    const forceKill = setTimeout(() => { if (timedOut || outputLimited) forceTerminateTree(child); }, timeoutMs + 1000);
    const finish = (result: ExecResult) => { if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(forceKill); resolve(result); };
    const stopForOutput = () => { if (outputLimited) return; outputLimited = true; terminateTree(child); };
    child.stdout.on("data", (chunk: Buffer) => { stdoutBytes += chunk.length; if (stdoutBytes > COMMAND_STDOUT_MAX_BYTES) stopForOutput(); else stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > COMMAND_STDERR_MAX_BYTES) stopForOutput(); else stderr.push(chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => finish({ stdout: "", stderr: "", code: 1, errorCategory: error.code === "ENOENT" ? "unavailable" : "exit_failure" }));
    child.on("close", (code) => {
      if (code === 0 && !timedOut && !outputLimited) return finish({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), code: 0 });
      const errorCategory = outputLimited ? "output_limit" : timedOut ? "timeout" : "exit_failure";
      finish({ stdout: "", stderr: "", code, errorCategory });
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
