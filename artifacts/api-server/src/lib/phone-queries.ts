import { eq, sql, type AnyColumn } from "drizzle-orm";
import { normalizePhoneNumber } from "./phone-numbers";

/** Match both legacy local numbers and newly stored international numbers without rewriting history. */
export function phoneMatches(column: AnyColumn, value: string) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return eq(column, value.trim());
  const digits = sql`regexp_replace(${column}, '[^0-9]', '', 'g')`;
  const canonical = sql`CASE
    WHEN ${digits} ~ '^0[235][0-9]{8}$' THEN '233' || substring(${digits} FROM 2)
    WHEN ${digits} ~ '^2330[235][0-9]{8}$' THEN '233' || substring(${digits} FROM 5)
    WHEN ${digits} ~ '^002330[235][0-9]{8}$' THEN '233' || substring(${digits} FROM 7)
    WHEN ${digits} ~ '^00[1-9][0-9]{7,14}$' THEN substring(${digits} FROM 3)
    ELSE ${digits}
  END`;
  return sql`${canonical} = ${normalized.slice(1)}`;
}
