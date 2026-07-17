import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, logout } from "./api";

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
});