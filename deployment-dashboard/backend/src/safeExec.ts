import { spawn } from "node:child_process";

const allowedCommands = new Set(["git", "npm", "pm2", "node"]);

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export function assertSafeCommand(command: string, args: string[]) {
  if (!allowedCommands.has(command)) throw new Error(`Command is not allowed: ${command}`);
  const unsafe = /[;&|`$<>]/;
  for (const part of [command, ...args]) {
    if (!part || unsafe.test(part)) throw new Error(`Unsafe command argument: ${part}`);
  }
}

export function execSafe(command: string, args: string[], cwd: string, onChunk?: (chunk: string) => void) {
  assertSafeCommand(command, args);
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      const text = buf.toString();
      stdout += text;
      onChunk?.(text);
    });
    child.stderr.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      onChunk?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
