import { createHmac, timingSafeEqual } from 'node:crypto';

export function validPaystackSignature(rawBody: Buffer, signature: string, secret: string) {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}
