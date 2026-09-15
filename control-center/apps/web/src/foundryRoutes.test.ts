import { describe, expect, it } from "vitest";
import { foundryPath, parseFoundryPath } from "./foundryRoutes";

describe("foundry routes", () => {
  it("returns null for non-foundry paths so the rest of the app is unaffected", () => {
    expect(parseFoundryPath("/")).toBeNull();
    expect(parseFoundryPath("/servers")).toBeNull();
    expect(parseFoundryPath("/foundryish")).toBeNull();
  });

  it("parses the landing, new, and projects routes", () => {
    expect(parseFoundryPath("/foundry")).toEqual({ kind: "landing" });
    expect(parseFoundryPath("/foundry/")).toEqual({ kind: "landing" });
    expect(parseFoundryPath("/foundry/new")).toEqual({ kind: "new" });
    expect(parseFoundryPath("/foundry/projects")).toEqual({ kind: "projects" });
  });

  it("parses a valid workflow id and rejects a malformed one", () => {
    const id = "0123456789abcdef01234567";
    expect(parseFoundryPath(`/foundry/projects/${id}`)).toEqual({ kind: "project", workflowId: id });
    // A non-ObjectId segment is not a project route; it degrades to the landing
    // rather than dropping the user out of the product.
    expect(parseFoundryPath("/foundry/projects/not-an-id")).toEqual({ kind: "landing" });
  });

  it("round-trips routes through foundryPath", () => {
    expect(foundryPath({ kind: "landing" })).toBe("/foundry");
    expect(foundryPath({ kind: "new" })).toBe("/foundry/new");
    expect(foundryPath({ kind: "projects" })).toBe("/foundry/projects");
    expect(foundryPath({ kind: "project", workflowId: "abc" })).toBe("/foundry/projects/abc");
  });
});
