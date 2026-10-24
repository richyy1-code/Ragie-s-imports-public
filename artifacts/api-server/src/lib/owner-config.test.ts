import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerEmails } from "./staff-access";

test("an unconfigured public installation has no implicit owners", () => {
  assert.equal(parseOwnerEmails(undefined).size, 0);
  assert.equal(parseOwnerEmails(" , ").size, 0);
});

test("owner configuration normalizes and deduplicates explicit emails", () => {
  assert.deepEqual([...parseOwnerEmails(" Owner@Example.com, other@example.com,owner@example.com ")],
    ["owner@example.com", "other@example.com"]);
});
