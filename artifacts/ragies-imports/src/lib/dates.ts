function formatDate(value: string | null | undefined, includeYear: boolean) {
  if (!value) return '—';
  // Arrival dates and ordering deadlines are calendar dates, not instants.
  // JS parses YYYY-MM-DD at UTC midnight; local formatting can subtract a day.
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat('en-GH', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    ...(calendarDate ? { timeZone: 'UTC' } : {}),
  }).format(new Date(value));
}

export const date = (value?: string | null) => formatDate(value, true);
export const shortDate = (value?: string | null) => formatDate(value, false);
