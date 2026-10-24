export function retainAvailableCategory(
  selectedSlug: string,
  categories: readonly { slug: string }[] | undefined,
): string {
  if (!selectedSlug || !categories) return selectedSlug;
  return categories.some((category) => category.slug === selectedSlug) ? selectedSlug : '';
}

export function categoryFromSearch(search: string): string {
  return new URLSearchParams(search).get('category') ?? '';
}

export function shopLocationWithCategory(path: string, search: string, category: string): string {
  const params = new URLSearchParams(search);
  if (category) params.set('category', category);
  else params.delete('category');
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
