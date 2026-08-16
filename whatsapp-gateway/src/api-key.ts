import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function generateApiKey(slug: string) {
  const prefix = `hr_app_${slug}_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  return { plain: `${prefix}.${secret}`, prefix };
}

export async function hashApiKey(value: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(value, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyApiKey(value: string, encoded: string) {
  const [algorithm, salt, expectedHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = await scrypt(value, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const requestHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
