import assert from "node:assert/strict";
import test from "node:test";
import { hasOnlyAvailableFeaturedCategories } from "./site-content-validation";

test("null selections preserve automatic defaults and empty selections are valid", () => {
  const available = new Set(["Bags", "Shoes"]);
  assert.equal(hasOnlyAvailableFeaturedCategories(null, available), true);
  assert.equal(hasOnlyAvailableFeaturedCategories(undefined, available), true);
  assert.equal(hasOnlyAvailableFeaturedCategories([], available), true);
});

test("homepage selections must still correspond to visible product categories", () => {
  const available = new Set(["Bags", "Shoes"]);
  assert.equal(hasOnlyAvailableFeaturedCategories(["Shoes", "Bags"], available), true);
  assert.equal(hasOnlyAvailableFeaturedCategories(["Shoes", "Retired"], available), false);
});
