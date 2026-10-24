import test from "node:test";
import assert from "node:assert/strict";
import {
  accountContactPhone, getExistingClerkUser, isMissingAccountError, missingAccountSessionMessage,
} from "./account-contact";

const user = {
  privateMetadata: {}, primaryPhoneNumberId: "native",
  phoneNumbers: [{ id: "native", phoneNumber: "+2330241234567" }],
};
test("saved contact is normalized and independent from native phone identity", () => {
  assert.equal(accountContactPhone(user), "+233241234567");
  assert.equal(accountContactPhone({ ...user, privateMetadata: { ragiesContactPhone: "+447911123456" } }), "+447911123456");
});
test("explicitly removed or invalid contact does not fall back to another phone", () => {
  for (const value of ["", null, 123, "not a phone"]) {
    assert.equal(accountContactPhone({ ...user, privateMetadata: { ragiesContactPhone: value } }), null);
  }
  assert.equal(accountContactPhone({ ...user, primaryPhoneNumberId: null }), null);
});
test("deleted Clerk accounts are treated as unavailable sessions, not server failures", () => {
  assert.equal(isMissingAccountError({ status: 404, errors: [{ code: "resource_not_found" }] }), true);
  for (const error of [null, undefined, new Error("network"), { status: 429 }, { status: 500 }, { status: 401 }]) {
    assert.equal(isMissingAccountError(error), false);
  }
});

test("balance-payment account lookup maps only a mocked deleted user to a sign-in response", async () => {
  const missing = await getExistingClerkUser("deleted", async () => {
    throw { status: 404, errors: [{ code: "resource_not_found" }] };
  });
  assert.equal(missing, null);
  assert.equal(missingAccountSessionMessage, "This account session is no longer available. Please sign in again.");

  const user = await getExistingClerkUser("existing", async (id) => ({ id }));
  assert.deepEqual(user, { id: "existing" });
  assert.equal(await getExistingClerkUser(null, async () => ({ id: "must-not-load" })), null);
  await assert.rejects(
    getExistingClerkUser("existing", async () => { throw { status: 503 }; }),
    (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 503,
  );
});
