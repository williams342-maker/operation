import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  FOLLOW_OS_WHEN_UNSET,
  applyTheme,
  resolveTheme,
  setTheme,
  storedTheme,
  THEME_STORAGE_KEY,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme system", () => {
  it("preserves dark as the platform default and does not follow the OS this pass", () => {
    // Guards the explicit requirement: the global default must remain dark.
    expect(DEFAULT_THEME).toBe("dark");
    expect(FOLLOW_OS_WHEN_UNSET).toBe(false);
  });

  it("resolves to the default when the user has made no selection", () => {
    expect(storedTheme()).toBeNull();
    expect(resolveTheme()).toBe("dark");
  });

  it("an explicit stored selection always wins", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(storedTheme()).toBe("light");
    expect(resolveTheme()).toBe("light");
  });

  it("ignores an invalid stored value and falls back to the default", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(storedTheme()).toBeNull();
    expect(resolveTheme()).toBe("dark");
  });

  it("setTheme persists the choice and applies it to the document", () => {
    setTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    // Survives a "reload" — a fresh resolve reads the persisted choice.
    expect(resolveTheme()).toBe("light");
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(resolveTheme()).toBe("dark");
  });

  it("applyTheme sets the data-theme attribute without persisting", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
