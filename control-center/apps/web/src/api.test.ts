import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiError, logout, SESSION_EXPIRED_EVENT, PASSWORD_CHANGE_REQUIRED_EVENT, PASSWORD_EXPIRED_MESSAGE } from "./api";

it("password-change 403 emits a recovery event without clearing the session", async () => {
  localStorage.setItem("cc.csrf", "otp-csrf");
  const required = vi.fn();
  window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, required);
  const error = new axios.AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, { status: 403, data: { code: "PASSWORD_CHANGE_REQUIRED" } } as never);
  const adapter = api.defaults.adapter;
  api.defaults.adapter = async () => { throw error; };
  try { await expect(api.get("/servers")).rejects.toBe(error); }
  finally { api.defaults.adapter = adapter; window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, required); }
  expect(required).toHaveBeenCalledOnce();
  expect(localStorage.getItem("cc.csrf")).toBe("otp-csrf");
});

it("expired OTP errors explain administrator reissue", () => {
  const error = new axios.AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, { status: 403, data: { code: "PASSWORD_EXPIRED" } } as never);
  expect(apiError(error)).toBe(PASSWORD_EXPIRED_MESSAGE);
});

describe("logout API", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("posts with the configured credential and CSRF interceptors and clears local auth", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { ok: true } });

    await logout();

    expect(post).toHaveBeenCalledWith("/auth/logout");
    expect(api.defaults.withCredentials).toBe(true);
    expect(localStorage.getItem("cc.csrf")).toBeNull();
  });

  it("treats an expired-session 401 as signed out locally", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    vi.spyOn(api, "post").mockRejectedValue(new axios.AxiosError("Authentication required", "ERR_BAD_REQUEST", undefined, undefined, { status: 401 } as never));

    await expect(logout()).resolves.toBeUndefined();
    expect(localStorage.getItem("cc.csrf")).toBeNull();
  });

  it("preserves local auth and rejects unexpected failures", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    vi.spyOn(api, "post").mockRejectedValue(new Error("Logout service unavailable"));

    await expect(logout()).rejects.toThrow("Logout service unavailable");
    expect(localStorage.getItem("cc.csrf")).toBe("csrf-token");
  });

  it("clears local authentication once when a protected request returns 401", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    const error = new axios.AxiosError("Authentication required", "ERR_BAD_REQUEST", undefined, undefined, { status: 401 } as never);
    const adapter = api.defaults.adapter;
    api.defaults.adapter = async () => { throw error; };

    try {
      await expect(api.get("/me")).rejects.toBe(error);
    } finally {
      api.defaults.adapter = adapter;
    }

    expect(localStorage.getItem("cc.csrf")).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it("does not clear authentication for a 403 permission denial", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    const denied = new axios.AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, { status: 403 } as never);
    const adapter = api.defaults.adapter;
    api.defaults.adapter = async () => { throw denied; };

    try {
      await expect(api.get("/admin/enrollment")).rejects.toBe(denied);
    } finally {
      api.defaults.adapter = adapter;
    }

    expect(localStorage.getItem("cc.csrf")).toBe("csrf-token");
  });
});
