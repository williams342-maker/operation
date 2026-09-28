import type { UserDoc } from "./models.js";

export const PASSWORD_EXPIRED_MESSAGE = "This one-time password has expired. Ask an administrator to re-issue it.";

// One setting applies to both new invitations and administrator password resets.
export function otpTtlHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CONTROL_CENTER_OTP_TTL_HOURS;
  if (raw === undefined) return 72;
  const hours = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(hours) || hours < 1 || !Number.isSafeInteger(hours * 3_600_000)) {
    throw new Error("CONTROL_CENTER_OTP_TTL_HOURS must be a positive integer whose duration in milliseconds is a safe integer.");
  }
  return hours;
}

export function oneTimePasswordExpired(user: Pick<UserDoc, "mustChangePassword" | "inviteIssuedAt">, now = Date.now()): boolean {
  if (user.mustChangePassword !== true) return false;
  const issued = user.inviteIssuedAt;
  // Legacy invitations without a valid timestamp need an administrator to reissue them.
  if (!(issued instanceof Date) || !Number.isFinite(issued.getTime()) || issued.getTime() > now) return true;
  return now - issued.getTime() >= otpTtlHours() * 3_600_000;
}
