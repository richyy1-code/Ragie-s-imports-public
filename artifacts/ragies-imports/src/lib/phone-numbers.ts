/** Browser equivalent of the server's canonical phone format, including legacy contacts. */
export function normalizeContactPhone(value: string): string | null {
  const input = value.trim().replace(/[\s().-]/g, "");
  if (/^0[235]\d{8}$/.test(input)) return `+233${input.slice(1)}`;
  if (/^233[235]\d{8}$/.test(input)) return `+${input}`;
  let international = input.startsWith("00") ? `+${input.slice(2)}` : input;
  if (/^\+?2330[235]\d{8}$/.test(international)) {
    international = `+233${international.replace(/^\+?2330/, "")}`;
  }
  if (international.startsWith("+233") && !/^\+233[235]\d{8}$/.test(international)) return null;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}

export function orderContactLinks(phone: string, whatsapp: string | null | undefined, message: string) {
  const whatsappNumber = whatsapp?.trim() || phone;
  const digits = (normalizeContactPhone(whatsappNumber) ?? whatsappNumber).replace(/\D/g, "");
  const smsNumber = normalizeContactPhone(phone) ?? phone.trim();
  const text = encodeURIComponent(message);
  return { whatsappHref: `https://wa.me/${digits}?text=${text}`, smsHref: `sms:${smsNumber}?body=${text}` };
}
