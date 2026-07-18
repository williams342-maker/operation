import assert from "node:assert/strict";
import test from "node:test";
import { aiAssistantRequestSchema, aiAssistantResponseSchema } from "../src/index.js";

test("AI request accepts only bounded read-only scopes", () => { assert.equal(aiAssistantRequestSchema.safeParse({ scope: { type: "server", id: "abc" }, question: "What happened?" }).success, true); assert.equal(aiAssistantRequestSchema.safeParse({ scope: { type: "shell", id: "abc" }, question: "run it" }).success, false); });
test("AI response requires empty executed actions", () => { const base = { summary: "Safe", status: "unknown", confidence: "low", risk: "low", likelyCauses: [], recommendedSteps: [], evidence: [], limitations: [], executedActions: [] }; assert.equal(aiAssistantResponseSchema.safeParse(base).success, true); assert.equal(aiAssistantResponseSchema.safeParse({ ...base, executedActions: [{ command: "restart" }] }).success, false); });
