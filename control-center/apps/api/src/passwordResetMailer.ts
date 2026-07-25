export type PasswordResetDeliveryResult = {
  status: "sent" | "not_configured" | "failed";
};

export function passwordResetUrl(token: string) {
  const rawBase = process.env.CONTROL_CENTER_PUBLIC_URL || process.env.CONTROL_CENTER_WEB_ORIGIN || "http://localhost:5173";
  const base = new URL(rawBase);
  base.pathname = "/reset-password";
  base.search = "";
  base.hash = "";
  base.searchParams.set("token", token);
  return base.toString();
}

export function emailLoginUrl(token: string) {
  const rawBase = process.env.CONTROL_CENTER_PUBLIC_URL || process.env.CONTROL_CENTER_WEB_ORIGIN || "http://localhost:5173";
  const base = new URL(rawBase);
  base.pathname = "/email-login";
  base.search = "";
  base.hash = new URLSearchParams({ token }).toString();
  return base.toString();
}

export async function sendPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
  requestId: string;
}): Promise<PasswordResetDeliveryResult> {
  const webhookUrl = process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL;
  if (!webhookUrl) return { status: "not_configured" };
  const url = new URL(webhookUrl);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    return { status: "failed" };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_TOKEN) {
    headers.authorization = `Bearer ${process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_TOKEN}`;
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: input.email,
        template: "opsworkbench-password-reset",
        resetUrl: input.resetUrl,
        requestId: input.requestId
      })
    });
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
}

export async function sendEmailLoginEmail(input: {
  email: string;
  loginUrl: string;
  requestId: string;
}): Promise<PasswordResetDeliveryResult> {
  const webhookUrl = process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL || process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL;
  if (!webhookUrl) return { status: "not_configured" };
  let url: URL;
  try { url = new URL(webhookUrl); } catch { return { status: "failed" }; }
  if ((process.env.NODE_ENV === "production" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) return { status: "failed" };
  const headers: Record<string, string> = { "content-type": "application/json" };
  const webhookToken = process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_TOKEN || process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_TOKEN;
  if (webhookToken) headers.authorization = `Bearer ${webhookToken}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: input.email,
        template: "opsworkbench-secure-email-login",
        loginUrl: input.loginUrl,
        requestId: input.requestId
      })
    });
    return { status: response.ok ? "sent" : "failed" };
  } catch {
    return { status: "failed" };
  }
}
