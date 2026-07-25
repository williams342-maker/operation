import assert from "node:assert/strict";
import test from "node:test";
import { aiAssistantRequestSchema, aiProviderIdSchema, aiWorkforceRole, aiWorkforceRoles } from "../src/index.js";

test("provider registry accepts only supported provider identifiers", () => {
  for (const provider of ["openai", "anthropic", "gemini", "openrouter", "mock"]) assert.equal(aiProviderIdSchema.parse(provider), provider);
  assert.throws(() => aiProviderIdSchema.parse("arbitrary-provider"));
});

test("workforce roles are fixed, read-only, and scope bounded", () => {
  assert.equal(new Set(aiWorkforceRoles.map((role) => role.id)).size, aiWorkforceRoles.length);
  for (const role of aiWorkforceRoles) {
    assert.equal(role.readOnly, true);
    assert.ok(role.suggestedQuestions.length > 0);
    assert.ok(role.allowedScopeTypes.length > 0);
    assert.equal(aiWorkforceRole(role.id), role);
  }
});

test("assistant requests default to the operations analyst role", () => {
  const request = aiAssistantRequestSchema.parse({ scope: { type: "server", id: "server-123456" }, question: "What changed?" });
  assert.equal(request.roleId, "operations_analyst");
  assert.throws(() => aiAssistantRequestSchema.parse({ scope: request.scope, roleId: "publisher", question: "Publish this" }));
});
