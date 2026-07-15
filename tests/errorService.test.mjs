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
