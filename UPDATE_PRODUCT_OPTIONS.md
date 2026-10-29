# Simple product options

## Product entry

Products now use one row layout with Size or type, Colour, and Quantity. All three fields are optional. Quantity starts at zero; clearing it also counts as zero. Add another option creates a new row. Remove deletes that row and updates the total.

Use one row with only a quantity for a product without size or colour choices. For a size only, leave Colour blank. For a colour only, leave Size or type blank. Enter labels as normal text; no colons, commas, or equals signs are required. If a label contains punctuation, it is treated literally.

Total quantity is computed from the rows. Negative numbers, fractions, duplicate size/type and colour pairs, and excessively large totals are rejected. A zero quantity is valid and cannot be purchased as available stock.

## Existing products

Existing products with quantities for each option load their saved counts into the rows. Existing products with one shared quantity retain that total when opened or saved without changing their options. Since the previous shared total does not establish a quantity for each option, changing those options requires entering their quantities first. No stock is automatically divided between choices.

Products without named options still track quantity; customers are not asked to select a made up size or colour. When a product intentionally has both an unnamed option and named options, the unnamed choice is displayed as Standard.

## Publish

This ZIP includes the earlier delivery address, combined account payment, and Messages reset changes.

1. If the order payment update has not been deployed, first follow UPDATE_ORDER_PAYMENTS.md and run its database command in Render Shell. The simple product rows do not require any additional database schema change.
2. Copy the extracted project contents into the existing private repository, replacing matching files.
3. Commit with: Simplify product options into size colour and quantity rows.
4. Push origin and wait for Render to finish deploying.
5. Open Admin > Products, add a product with a couple of options, and check the automatic total and its choices in the shop.

## Validation

150 regression tests pass. Browser checks covered the admin row editor and the actual product page logic with synthetic products. Disposable PostgreSQL checks exercised product API reads and checkout for eight combinations across Ghana stock and preorders, including oversell rejection and stock deduction. Provider transactions and SMS transport were not called.
