import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const emailSchema = z.email().max(254).transform(value => value.toLowerCase());
export const passwordSchema = z.string().min(12, "Use pelo menos 12 caracteres.").max(128, "Use no máximo 128 caracteres.");
export const registrationSchema = z.object({ name: z.string().trim().min(2).max(80).refine(value => !/\p{C}/u.test(value)), email: emailSchema, password: passwordSchema, terms: z.literal(true) }).strict();
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: string) { return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, options, (error, result) => error ? reject(error) : resolve(result))); }
export async function hashPassword(password: string) {
  const salt = randomBytes(24).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{48}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = await derive(password, parts[1]);
  return timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
}
// Performs the same derivation for unknown accounts to avoid a fast-path enumeration signal.
export const dummyPasswordHash = `scrypt$${"0".repeat(48)}$${"0".repeat(128)}`;
