export const HOMEPAGE_FEATURED_CATEGORY_LIMIT = 3;

export function resolveFeaturedCategories(
  saved: readonly string[] | null | undefined,
  categories: readonly { slug: string }[] | undefined,
): string[] {
  if (!categories) return saved ? [...saved].slice(0, HOMEPAGE_FEATURED_CATEGORY_LIMIT) : [];
  const available = new Set(categories.map((category) => category.slug));
  const requested = saved ?? categories.slice(0, HOMEPAGE_FEATURED_CATEGORY_LIMIT).map((category) => category.slug);
  return requested
    .filter((slug, index) => available.has(slug) && requested.indexOf(slug) === index)
    .slice(0, HOMEPAGE_FEATURED_CATEGORY_LIMIT);
}

export function toggleFeaturedCategory(selected: readonly string[], slug: string): string[] {
  if (selected.includes(slug)) return selected.filter((item) => item !== slug);
  if (selected.length >= HOMEPAGE_FEATURED_CATEGORY_LIMIT) return [...selected];
  return [...selected, slug];
}

export function moveFeaturedCategory(selected: readonly string[], index: number, direction: -1 | 1): string[] {
  const destination = index + direction;
  if (index < 0 || index >= selected.length || destination < 0 || destination >= selected.length) {
    return [...selected];
  }
  const next = [...selected];
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}
