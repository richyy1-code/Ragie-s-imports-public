import assert from "node:assert/strict";
import test from "node:test";
import {
  HOMEPAGE_FEATURED_CATEGORY_LIMIT,
  moveFeaturedCategory,
  resolveFeaturedCategories,
  toggleFeaturedCategory,
} from "./featured-categories";

const categories = [{ slug: "bags" }, { slug: "shoes" }, { slug: "home" }, { slug: "jewelry" }];

test("unset selections preserve the current homepage default; saved order is authoritative", () => {
  assert.deepEqual(resolveFeaturedCategories(null, categories), ["bags", "shoes", "home"]);
  assert.deepEqual(resolveFeaturedCategories(undefined, categories), ["bags", "shoes", "home"]);
  assert.deepEqual(resolveFeaturedCategories(["home", "bags"], categories), ["home", "bags"]);
  assert.deepEqual(resolveFeaturedCategories([], categories), []);
});

test("removed categories are omitted and saved lists stay unique and within the card limit", () => {
  assert.deepEqual(
    resolveFeaturedCategories(["home", "removed", "home", "bags", "shoes"], categories),
    ["home", "bags", "shoes"],
  );
  assert.equal(HOMEPAGE_FEATURED_CATEGORY_LIMIT, 3);
});

test("staff can select, remove and reorder featured categories", () => {
  assert.deepEqual(toggleFeaturedCategory(["bags"], "shoes"), ["bags", "shoes"]);
  assert.deepEqual(toggleFeaturedCategory(["bags", "shoes"], "bags"), ["shoes"]);
  assert.deepEqual(toggleFeaturedCategory(["bags", "shoes", "home"], "jewelry"), ["bags", "shoes", "home"]);
  assert.deepEqual(moveFeaturedCategory(["bags", "shoes", "home"], 2, -1), ["bags", "home", "shoes"]);
  assert.deepEqual(moveFeaturedCategory(["bags", "shoes"], 0, -1), ["bags", "shoes"]);
});
