/**
 * Everything extracted from a customer repository passes through here before
 * it is stored (0042).
 *
 * The repository is untrusted input. A stored value eventually reaches a model
 * prompt and a React page, so a CSS value carrying `url(javascript:…)`, an
 * angle bracket or a backtick is not a value we keep — it is dropped and
 * counted. Validation is conservative on purpose: a legitimate value that is
 * refused costs one missing swatch, while a value that should not have been
 * kept costs rather more.
 */

/** Longest CSS value we keep. Real tokens are short; long ones are payloads. */
const MAX_VALUE_LENGTH = 80;

/** Names, identifiers, component names, CSS custom-property names. */
const NAME_PATTERN = /^[A-Za-z0-9_.$@/-]{1,80}$/;

/** Substrings that disqualify a CSS value outright, whatever else it says. */
const FORBIDDEN = [/url\s*\(/i, /expression\s*\(/i, /javascript:/i, /<|>/, /`/, /@import/i];

export interface DropCounter {
  dropped: number;
  reasons: Set<string>;
}

export function newDropCounter(): DropCounter {
  return { dropped: 0, reasons: new Set() };
}

function drop(counter: DropCounter | undefined, reason: string): null {
  if (counter) {
    counter.dropped += 1;
    counter.reasons.add(reason);
  }
  return null;
}

/**
 * A CSS value safe to store and show: a colour, length, font stack, shadow.
 * Returns the trimmed value, or null when it is refused.
 */
export function validCssValue(raw: unknown, counter?: DropCounter): string | null {
  if (typeof raw !== "string") return drop(counter, "not a string");
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return drop(counter, "empty");
  if (value.length > MAX_VALUE_LENGTH) return drop(counter, "too long");
  for (const bad of FORBIDDEN) {
    if (bad.test(value)) return drop(counter, "forbidden construct");
  }
  // Control characters never belong in a token value.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return drop(counter, "control characters");
  return value;
}

/** A name or identifier safe to store. */
export function validName(raw: unknown, counter?: DropCounter): string | null {
  if (typeof raw !== "string") return drop(counter, "not a string");
  const name = raw.trim();
  if (!NAME_PATTERN.test(name)) return drop(counter, "invalid name");
  return name;
}

/**
 * A path we are willing to store: it must actually exist in the repository
 * tree we listed. A path we never saw is a path we cannot stand behind.
 */
export function validPath(raw: unknown, tree: Set<string>, counter?: DropCounter): string | null {
  if (typeof raw !== "string") return drop(counter, "not a string");
  const path = raw.trim().replace(/^\.\//, "");
  if (!path || path.length > 400) return drop(counter, "invalid path");
  if (!tree.has(path)) return drop(counter, "path not in repository");
  return path;
}

/** The warning lines a drop counter contributes to the stored profile. */
export function dropWarnings(counter: DropCounter, what: string): string[] {
  if (counter.dropped === 0) return [];
  return [`${counter.dropped} ${what} dropped by validation (${[...counter.reasons].sort().join(", ")})`];
}
