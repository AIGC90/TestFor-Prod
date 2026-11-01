/**
 * Masks personal identifiers before data reaches the model: Aadhar numbers (12 digits, optionally
 * grouped 4-4-4), Indian mobile numbers and Saudi mobile numbers (05XXXXXXXX / +966 5XXXXXXXX).
 * Longer digit runs such as IMEIs are left alone.
 */
const AADHAR = /(?<![\d])(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?![\d])/g;
const MOBILE = /(?<![\d+])(\+?91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})(?![\d])/g;
const SAUDI_MOBILE = /(?<![\d+])(\+?966[\s-]?|0)5(\d)[\s-]?(\d{3})[\s-]?(\d{4})(?![\d])/g;

export function maskPii(text: string): string {
  return text
    .replace(SAUDI_MOBILE, (_m, cc: string, _a, _b, d: string) => `${cc === '0' ? '05' : '+966 5'}XXXXX${d}`)
    .replace(AADHAR, (_m, _a, _b, c) => `XXXX-XXXX-${c}`).replace(MOBILE, (_m, cc, _a, b: string) => `${cc ? '+91 ' : ''}XXXXXX${b.slice(-4)}`);
}

/** JSON-encodes a tool result, masks it, and keeps it within a size the model can use. */
export function toolJson(value: unknown, max = 40_000): string {
  const s = maskPii(JSON.stringify(value));
  return s.length > max ? `${s.slice(0, max)}… [truncated: ${s.length - max} more characters; narrow the query]` : s;
}
