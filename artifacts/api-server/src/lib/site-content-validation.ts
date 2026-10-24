export function hasOnlyAvailableFeaturedCategories(
  selected: readonly string[] | null | undefined,
  available: ReadonlySet<string>,
): boolean {
  return selected == null || selected.every((category) => available.has(category));
}
