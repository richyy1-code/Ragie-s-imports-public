/** Accept Ghana local numbers and keep explicit international country codes. */
export function normalizePhoneNumber(value: string): string | null {
  const input = value.trim().replace(/[\s().-]/g, "");
  if (/^0[235]\d{8}$/.test(input)) return `+233${input.slice(1)}`;
  if (/^233[235]\d{8}$/.test(input)) return `+${input}`;
  let international = input.startsWith("00") ? `+${input.slice(2)}` : input;
  // Ghana's local trunk zero is accepted after the country code, but must not
  // reach the SMS provider or WhatsApp as an extra subscriber digit.
  if (/^\+?2330[235]\d{8}$/.test(international)) {
    international = `+233${international.replace(/^\+?2330/, "")}`;
  }
  if (international.startsWith("+233") && !/^\+233[235]\d{8}$/.test(international)) return null;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}

export const storedPhoneNumber = (value: string) => normalizePhoneNumber(value) ?? value.trim();
export const optionalPhoneNumber = (value: string | null | undefined) =>
  value?.trim() ? storedPhoneNumber(value) : null;
