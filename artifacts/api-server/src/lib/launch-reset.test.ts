import assert from "node:assert/strict";
import test from "node:test";
import { accountPaymentsTable, ordersTable, productsTable, shipmentsTable, smsNotificationsTable } from "@workspace/db";
import { clearLaunchDatabase } from "./launch-reset";

function fakeTransaction(sizes: number[]) {
  const operations: unknown[] = [];
  const tx = {
    async execute() { operations.push("lock"); },
    delete(table: unknown) {
      operations.push(table);
      return { async returning() { return Array.from({ length: sizes.shift() ?? 0 }, (_, id) => ({ id })); } };
    },
  };
  return { tx: tx as unknown as Parameters<typeof clearLaunchDatabase>[0], operations };
}

test("launch reset clears messages before orders, products and batches without touching protected settings", async () => {
  const { tx, operations } = fakeTransaction([4, 5, 3, 2, 1]);
  assert.deepEqual(await clearLaunchDatabase(tx), {
    productsDeleted: 2, ordersDeleted: 3, shipmentsDeleted: 1,
    smsNotificationsDeleted: 4, accountPaymentsDeleted: 5, databaseAlreadyReset: false,
  });
  assert.deepEqual(operations, ["lock", smsNotificationsTable, accountPaymentsTable, ordersTable, productsTable, shipmentsTable]);
});

test("leftover batches or standalone messages mean the database is not already reset", async () => {
  for (const sizes of [[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 0, 0, 1]]) {
    assert.equal((await clearLaunchDatabase(fakeTransaction(sizes).tx)).databaseAlreadyReset, false);
  }
  assert.equal((await clearLaunchDatabase(fakeTransaction([0, 0, 0, 0, 0]).tx)).databaseAlreadyReset, true);
});

test("a deletion failure aborts the transaction callback rather than reporting success", async () => {
  const { tx } = fakeTransaction([]);
  tx.delete = (() => ({ returning: async () => { throw new Error("synthetic failure"); } })) as unknown as typeof tx.delete;
  await assert.rejects(clearLaunchDatabase(tx), /synthetic failure/);
});
