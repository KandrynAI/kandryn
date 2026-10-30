import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateCode,
  hashCode,
  looksLikeCode,
  normalizeCode,
} from "./codes.js";

/**
 * The typed linking code.
 *
 * A human reads this off one screen and types it into another, so the
 * failure modes are human: a misread character, a code typed in groups, caps
 * lock. The guessing resistance has to survive all that forgiveness.
 */

test("the alphabet contains no character that can be misread as another", () => {
  // 0/O, 1/I/L and U (misheard as V) are all absent by design.
  for (const ch of "01OILU") assert.ok(!CODE_ALPHABET.includes(ch), `${ch} must not be in the alphabet`);
  assert.equal(new Set(CODE_ALPHABET).size, CODE_ALPHABET.length, "no duplicate symbols");
  assert.ok(CODE_ALPHABET.length >= 28, "enough symbols to keep guessing hopeless");
});

test("a generated code is the right length and only ever uses the alphabet", () => {
  for (let i = 0; i < 500; i++) {
    const code = generateCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `${ch} is outside the alphabet`);
  }
});

test("generated codes do not repeat in any realistic run", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(generateCode());
  assert.equal(seen.size, 2000, "a collision here would mean the generator is not random");
});

test("every symbol in the alphabet actually gets used", () => {
  // A modulus bug would quietly starve the tail of the alphabet.
  const used = new Set<string>();
  for (let i = 0; i < 20_000; i++) for (const ch of generateCode()) used.add(ch);
  assert.equal(used.size, CODE_ALPHABET.length, "some symbol is unreachable");
});

test("typing is forgiven: case, spaces and grouping dashes", () => {
  assert.equal(normalizeCode(" ab-cd ef "), "ABCDEF");
  assert.equal(normalizeCode("abcdef"), "ABCDEF");
  assert.equal(normalizeCode("AB CD-EF"), "ABCDEF");
  assert.equal(normalizeCode(""), "");
});

test("the hash is of the normalized code, so how it was typed does not matter", () => {
  const code = generateCode();
  const grouped = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();
  assert.equal(hashCode(grouped), hashCode(code));
  assert.equal(hashCode(` ${code} `), hashCode(code));
  // sha256 hex, and nothing resembling the code itself.
  assert.match(hashCode(code), /^[0-9a-f]{64}$/);
  assert.ok(!hashCode(code).includes(code.toLowerCase()));
});

test("different codes hash differently", () => {
  const a = generateCode();
  let b = generateCode();
  while (b === a) b = generateCode();
  assert.notEqual(hashCode(a), hashCode(b));
});

test("looksLikeCode screens the obvious rubbish without being a check", () => {
  assert.equal(looksLikeCode(generateCode()), true);
  assert.equal(looksLikeCode("short"), false);
  assert.equal(looksLikeCode("0000000000"), false, "0 is not in the alphabet");
  assert.equal(looksLikeCode("ABCDEFGHJK"), true);
  assert.equal(looksLikeCode(""), false);
});
