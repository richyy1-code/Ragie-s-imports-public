import assert from "node:assert/strict";
import test from "node:test";
import { getLiveSmsCredentials, getSmsPublicConfiguration } from "./sms-config";

const liveApp = { AFRICAS_TALKING_API_KEY: "synthetic-key", AFRICAS_TALKING_USERNAME: "ragiesimports" };

test("A live key and username without an approved sender keep sending paused", () => {
  assert.equal(getLiveSmsCredentials(liveApp), null);
  assert.deepEqual(getSmsPublicConfiguration(liveApp), {
    mode: "live", configured: false, username: "ragiesimports", senderId: null,
    missingSettings: ["Approved sender ID (up to 11 characters)"],
  });
});
test("Missing key or real username never falls back to sandbox", () => {
  for (const env of [
    {},
    { AFRICAS_TALKING_API_KEY: "synthetic-key", AFRICAS_TALKING_SENDER_ID: "RAGIES" },
    { ...liveApp, AFRICAS_TALKING_USERNAME: "sandbox", AFRICAS_TALKING_SENDER_ID: "RAGIES" },
    { ...liveApp, AFRICAS_TALKING_USERNAME: "Sandbox", AFRICAS_TALKING_SENDER_ID: "RAGIES" },
    { ...liveApp, AFRICAS_TALKING_API_KEY: "", AFRICAS_TALKING_SENDER_ID: "RAGIES" },
  ]) assert.equal(getLiveSmsCredentials(env), null);
});
test("Invalid or blank sender IDs pause sending", () => {
  for (const sender of ["", "  ", "TWELVECHARSX", "RAGIES\nBAD"]) {
    assert.equal(getLiveSmsCredentials({ ...liveApp, AFRICAS_TALKING_SENDER_ID: sender }), null);
  }
});
test("Complete live credentials use exactly the configured username and approved sender", () => {
  const env = { ...liveApp, AFRICAS_TALKING_USERNAME: " ragiesimports ", AFRICAS_TALKING_SENDER_ID: " RAGIES " };
  assert.deepEqual(getLiveSmsCredentials(env), { apiKey: "synthetic-key", username: "ragiesimports", senderId: "RAGIES" });
  const publicConfig = getSmsPublicConfiguration(env);
  assert.equal(publicConfig.configured, true);
  assert.equal(JSON.stringify(publicConfig).includes("synthetic-key"), false);
  assert.equal("apiKey" in publicConfig, false);
});
