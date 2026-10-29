# Latest validation: simple product option rows

* 150 regression tests pass, including default zero quantities, literal labels, optional size/colour dimensions, saved row reloads, legacy shared stock preservation, duplicate rejection, and stock deduction/restoration.
* Browser checks pass for adding and removing rows, optional fields, automatic totals, saved values, mobile layout, and explicit legacy stock entry.
* Product page browser checks pass for quantity only, size only, colour only, mixed standard/named choices, correct cart selections, and zero stock blocking purchases.
* Disposable PostgreSQL and HTTP checks pass for eight option combinations across Ghana stock and preorders, including API response validation, oversell rejection, and stock deduction after synthetic verified payment handling.
* Workspace type checks and the production build pass.
* No live payment, SMS delivery, or production database changes were performed.

The option editor needs no additional database migration. If the bundled order payment update has not been applied yet, follow UPDATE_ORDER_PAYMENTS.md before deploying.

---

# Latest validation

## Order payment and delivery update

* All 145 deployment regression tests pass.
* Full workspace type checking and production build pass.
* Eight synthetic database checks pass using embedded PostgreSQL: combined settlement across orders, new delivery addresses, idempotent callback handling, invalid payment rejection, overlapping payments retained for review, cancellation, fee changes, transaction rollback, and clearing every Messages state plus payment receipts. The reported eight checks include the parent settlement test and the standalone reset test.
* The additive account_payments migration was applied twice successfully to check repeatability.
* HTTP checks with a disposable database and mocked Clerk and Paystack passed: sign in, customer ownership, missing address rejection, changed balance rejection, duplicate order rejection, exact payment amounts, and both individual payment options. Addresses remain unchanged before payment confirmation.
* Browser checks passed for individual shipping and arrears controls, address validation, the combined payment request, provider redirection, and mobile layout without horizontal overflow. The browser used a component harness with synthetic orders rather than live Clerk accounts.
* No live Paystack payment, SMS delivery, production database mutation, or load test was performed.

Apply the database command in UPDATE_ORDER_PAYMENTS.md before publishing the code. The migration creates a new table and does not delete existing orders. The owner reset remains an explicitly destructive action and is not part of deployment.
