import { createHash, randomInt } from "node:crypto";

/**
 * The typed linking codes (0043). Pure, so the alphabet, the normalization
 * and the hashing are testable without a database.
 *
 * A code is read off a screen and typed into another, by a human, under mild
 * time pressure. That shapes every choice here: no character that can be
 * misread as another, a length that is short enough to retype but long enough
 * that guessing is hopeless, and normalization forgiving of how people
 * actually type (spaces, lower case, a stray dash).
 */

/**
 * Deliberately missing: 0/O, 1/I/L, and U (misheard as V when read aloud).
 * 29 symbols over 10 positions is ~10^14 codes, against a 5-attempt limit and
 * a 10-minute life.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LENGTH = 10;
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses allowed against one code before it is dead. */
export const MAX_CODE_ATTEMPTS = 5;
/** Wrong guesses allowed per signed-in user per hour. */
export const MAX_USER_FAILURES_PER_HOUR = 10;
/** Codes a single Jira account may mint per hour. */
export const MAX_STARTS_PER_HOUR = 5;

/**
 * A fresh code. `randomInt` is the CSPRNG, and it is used with a modulus-free
 * range so every symbol is equally likely — a biased code is a smaller code.
 */
export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

/**
 * What the person typed, reduced to what was meant: case folded, and spaces
 * and dashes dropped because a 10-character code gets typed in groups.
 */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, "").trim().toUpperCase();
}

/** Only this ever reaches the database. The code itself is never stored. */
export function hashCode(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

/** Whether a typed string could be one of our codes at all. */
export function looksLikeCode(input: string): boolean {
  const c = normalizeCode(input);
  if (c.length !== CODE_LENGTH) return false;
  for (const ch of c) if (!ALPHABET.includes(ch)) return false;
  return true;
}

export const CODE_ALPHABET = ALPHABET;
