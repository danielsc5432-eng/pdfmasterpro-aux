import test from "node:test";
import assert from "node:assert/strict";
import { removeClippedText } from "../../lib/processing/pdf-visible-text";

test("only text outside the field clip is excluded from extraction", () => {
  const source = "q 303 685 114 11 re W n BT /F0 9 Tf 339 687 Td (AUXILIAR) Tj ET Q\nq 303 685 114 11 re W n BT /F0 9 Tf 323 676 Td (ADMINISTRATIVO) Tj ET Q";
  const filtered = removeClippedText(source);
  assert.match(filtered, /\(AUXILIAR\) Tj/);
  assert.doesNotMatch(filtered, /ADMINISTRATIVO/);
  assert.match(filtered, /303 685 114 11 re W n/);
});
test("nested transformed clips preserve visible escaped strings", () => {
  const source = "q 2 0 0 2 10 20 cm 0 20 100 10 re W n q BT /F0 9 Tf 0 22 Td (visible \\(ET Q\\)) Tj ET Q Q BT /F0 9 Tf 0 0 Td (unclipped) Tj ET";
  assert.equal(removeClippedText(source), source);
});
test("uncertain glyph advances, curves and rotated text are retained", () => {
  const source = "q 0 20 100 10 re W n BT /F0 9 Tf 0 0 Td (first) Tj (second) Tj ET Q\nq 0 20 m 30 40 l W n BT /F0 9 Tf 0 0 Td (curve) Tj ET Q\nq 0 20 100 10 re W n BT /F0 9 Tf 0 1 -1 0 0 0 Tm (rotated) Tj ET Q";
  assert.equal(removeClippedText(source), source);
});
