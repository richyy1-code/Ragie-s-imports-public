import assert from "node:assert/strict";
import test from "node:test";
import {
  isMissingAccountSessionError, MISSING_ACCOUNT_SESSION_MESSAGE,
} from "./missing-account-session";

test("only the explicit deleted-account 401 triggers session cleanup", () => {
  assert.equal(isMissingAccountSessionError({
    status: 401, data: { error: MISSING_ACCOUNT_SESSION_MESSAGE },
  }), true);
  for (const error of [
    { status: 401, data: { error: "Sign in required." } },
    { status: 403, data: { error: MISSING_ACCOUNT_SESSION_MESSAGE } },
    { status: 404, data: { error: MISSING_ACCOUNT_SESSION_MESSAGE } },
    { status: 500, data: { error: MISSING_ACCOUNT_SESSION_MESSAGE } },
    { status: 401, data: null },
    new Error(MISSING_ACCOUNT_SESSION_MESSAGE),
    null,
  ]) assert.equal(isMissingAccountSessionError(error), false);
});
