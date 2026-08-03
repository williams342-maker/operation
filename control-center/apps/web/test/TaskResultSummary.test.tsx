import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskResultSummary, taskDisplaySummary } from "../src/TaskResultSummary.js";

test("success summaries preserve explicit text and provide a truthful default", () => {
  assert.equal(taskDisplaySummary("succeeded", "Inventory collected"), "Inventory collected");
  assert.equal(taskDisplaySummary("succeeded", undefined), "Task completed successfully");
});

test("failure summaries preserve explicit text and provide a truthful default", () => {
  assert.equal(taskDisplaySummary("failed", "Collector exited"), "Collector exited");
  assert.equal(taskDisplaySummary("failed", undefined), "Task failed");
});

test("terminal state overrides reserved contradictory and stale summaries", () => {
  assert.equal(taskDisplaySummary("succeeded", "Task failed"), "Task completed successfully");
  assert.equal(taskDisplaySummary("failed", "Task completed successfully"), "Task failed");
  assert.equal(taskDisplaySummary("expired", "Task completed successfully"), "Task expired");
  assert.equal(taskDisplaySummary("cancelled", "Task failed"), "Task cancelled");
});

test("component renders the state-normalized summary and omits nonterminal summaries", () => {
  assert.match(renderToStaticMarkup(<TaskResultSummary state="succeeded" summary="Task failed" />), /Task completed successfully/);
  assert.equal(renderToStaticMarkup(<TaskResultSummary state="running" summary="Task failed" />), "");
});

test("task detail binds the persisted state and result summary to truthful rendering", () => {
  const source = fs.readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(source, /<TaskResultSummary state=\{detail\.data\?\.task\?\.state\} summary=\{detail\.data\?\.task\?\.resultSummary\} \/>/);
});
