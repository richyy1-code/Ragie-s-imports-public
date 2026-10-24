# Unpaid preorder stock holds

Public preorder checkout holds expire **30 minutes after checkout creation**.
Opening another payment page does not extend the deadline. Paid deposits (80%
or more) and fully paid orders never expire. Ghana-ready stock continues to be
allocated only on confirmed full payment.

## Persistent state and rollout

The existing JSONB order-item snapshot stores `stockDeducted`,
`preorderReservationExpiresAt` (ISO instant), and `preorderStockTracked`. No table,
column, or database-default change is needed. **No schema push, destructive
migration, or inventory backfill is required for this release.** Roll out the
server changes together. Existing paid orders with absent markers keep their
legacy allocation and are never deducted again.

Legacy unpaid public orders in `Awaiting Payment` have an implicit deadline of
`createdAt + 30 minutes`. Their first expiry transaction restores their existing
holds and persists the released marker. Other legacy/offline orders are excluded.
There is no bulk rewrite of order history or deletion of pending payment records.

The current stock model is preserved: size/colour quantity matrices are finite
and reserve individual combinations. Plain no-choice, size-only, and
size/colour-choice preorders have not deducted aggregate inventory; they still do
not. The snapshot records whether finite stock was actually reserved, so a later
catalog mode change cannot invent stock on release. Unreconcilable finite
option changes retain the allocation and emit an error for staff to investigate.

## Expiry, late payments, and fulfillment

A startup/minutely worker releases overdue unpaid holds, at most 100 per sweep.
Catalog reads, new checkout, and initial payment preparation also run a bounded
sweep, including after a sleeping server resumes. Each release locks its order
and products; release and its marker commit together. Paid orders, trashed
orders, and already released items cannot be released again. Trash/restore uses
the same allocation markers.

Expired checkout payment initialization returns 409 and requires a new checkout.
A payment provider page already opened may still complete after that deadline.
Verified payment application locks the same order row. If the hold is still
allocated it is finalized without releasing stock. If expiry committed first,
payment attempts to reacquire the exact combinations atomically. Concurrent
payment, expiry, webhook, and callback operations serialize on that lock.

If stock cannot be reacquired, the actual money remains recorded. The visible
paid order is `Stock unavailable`, with no shipping or pickup authorization.
Shipment synchronization preserves this block. There is no automatic refund or
substitution. Staff must reconcile the order; retrying confirmation or an
authorized staff update can allocate stock after availability is corrected,
without a second financial increment or inventory deduction.

## Synthetic verification

Run with the development API workflow active:

```
RUN_PREORDER_RESERVATION_INTEGRATION=1 pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/preorder-reservations.integration.test.ts
```

The suite only creates uniquely named synthetic products, batches, and orders;
cleanup uses captured IDs. Fixture phone numbers are invalid, so notification
outbox rows are skipped. Verified payments are synthetic inputs to the internal
applier; no Paystack verification, initialization, charge, refund, or SMS send is
performed. Existing payment and option regression tests should also be run.
