import assert from "node:assert/strict";
import test from "node:test";

import { getSafeErrorCategory, getSafeUserError } from "../src/services/errorService.js";

test("classifies hosted fetch failed errors without exposing backend details", () => {
  const error = new Error("fetch failed: private backend response");

  assert.equal(getSafeErrorCategory(error), "network");
  assert.equal(
    getSafeUserError(error, "auth"),
    "Unable to connect. Check your internet connection and try again.",
  );
  assert.doesNotMatch(getSafeUserError(error, "auth"), /private backend response/i);
});

test("classifies HTTP 429 responses without relying on raw message text", () => {
  const error = { status: 429, message: "private gateway response" };

  assert.equal(getSafeErrorCategory(error), "rate_limit");
  assert.equal(getSafeUserError(error, "auth"), "Too many attempts. Wait a moment and try again.");
  assert.doesNotMatch(getSafeUserError(error, "auth"), /private gateway response/i);
});

test("tolerates hostile error-property getters", () => {
  const error = {};
  Object.defineProperties(error, {
    message: { get() { throw new Error("private message getter"); } },
    code: { get() { throw new Error("private code getter"); } },
    status: { get() { throw new Error("private status getter"); } },
  });

  assert.doesNotThrow(() => getSafeErrorCategory(error));
  assert.equal(getSafeErrorCategory(error), "unknown");
  assert.equal(getSafeUserError(error, "save"), "We couldn't save your changes. Please refresh and try again.");
});

test("maps stale reopen-packing failures to an actionable safe message", () => {
  assert.equal(
    getSafeUserError(new Error("Only Packed Orders can be reopened for packing."), "order_mutation"),
    "This Order is no longer eligible to be reopened for packing.",
  );
});
