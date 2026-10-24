import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContactPhone, orderContactLinks } from "./phone-numbers";
import { normalizePhoneNumber, optionalPhoneNumber } from "../../../api-server/src/lib/phone-numbers";

test("Frontend and backend agree on Ghana local and international formats", () => {
  const cases = [
    ["0241234567", "+233241234567"], ["0551234567", "+233551234567"],
    ["020 123 4567", "+233201234567"], ["(054) 123-4567", "+233541234567"],
    ["233241234567", "+233241234567"], ["+233241234567", "+233241234567"],
    ["+2330241234567", "+233241234567"], ["2330241234567", "+233241234567"],
    ["002330241234567", "+233241234567"], ["+233 (024) 123-4567", "+233241234567"],
    ["+390612345678", "+390612345678"],
    ["00233241234567", "+233241234567"], ["+254711123456", "+254711123456"],
    ["0000000000", null], ["024123", null], ["", null], ["hello", null],
  ] as const;
  for (const [input, expected] of cases) {
    assert.equal(normalizeContactPhone(input), expected, input);
    assert.equal(normalizePhoneNumber(input), expected, input);
  }
});
test("malformed Ghana subscriber digits are rejected instead of kept as a deliverable contact", () => {
  for (const input of ["+23300241234567", "+233024123456", "+23302412345678", "+2330991234567"]) {
    assert.equal(normalizeContactPhone(input), null, input);
    assert.equal(normalizePhoneNumber(input), null, input);
  }
});
test("WhatsApp uses country-code digits while SMS retains the international plus sign", () => {
  const links = orderContactLinks("0241234567", null, "Order ready");
  assert.equal(links.whatsappHref, "https://wa.me/233241234567?text=Order%20ready");
  assert.equal(links.smsHref, "sms:+233241234567?body=Order%20ready");
});
test("A separate local WhatsApp number does not replace the SMS recipient", () => {
  const links = orderContactLinks("0241234567", "0551234567", "Payment confirmed");
  assert.match(links.whatsappHref, /wa.me\/233551234567/);
  assert.match(links.smsHref, /^sms:\+233241234567/);
});
test("Blank optional WhatsApp numbers fall back to the customer's phone", () => {
  assert.match(orderContactLinks("0241234567", "   ", "Update").whatsappHref, /wa.me\/233241234567/);
  assert.equal(optionalPhoneNumber(" "), null);
  assert.equal(optionalPhoneNumber(null), null);
  assert.equal(optionalPhoneNumber("0241234567"), "+233241234567");
});
test("Already international WhatsApp numbers are not given a second Ghana country code", () => {
  assert.match(orderContactLinks("+233241234567", "+254711123456", "Update").whatsappHref, /wa.me\/254711123456/);
});
