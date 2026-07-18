import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigurationDeploymentWorkflow } from "../src/ConfigurationDeploymentWorkflow.js";

test("production workflow is independently unavailable", () => { const html = renderToStaticMarkup(<ConfigurationDeploymentWorkflow environmentKind="production" protectedEnvironment />); assert.match(html, /Production unavailable/); assert.match(html, /disabled/); });
test("non-production workflow describes approval progress and rollback", () => { const html = renderToStaticMarkup(<ConfigurationDeploymentWorkflow environmentKind="staging" state="pending_approval" />); assert.match(html, /Independent approval/); assert.match(html, /Success or rollback/); assert.match(html, /value-free/); assert.doesNotMatch(html, /credential value|ciphertext|shell command/i); });
