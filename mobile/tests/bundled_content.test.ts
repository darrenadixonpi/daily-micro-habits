import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BUNDLED_CONTENT, BUNDLED_FILE_NAMES } from '../src/content/bundled_content';
import { formulaToText } from '../src/content/formula_text';

test('every /content file is bundled into the app', () => {
  const files = readdirSync(join(__dirname, '..', '..', 'content')).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual([...BUNDLED_FILE_NAMES].sort(), files);
});

test('bundled IDs are unique', () => {
  const ids = [...BUNDLED_CONTENT.a1.map((w) => w.id), ...BUNDLED_CONTENT.a3.map((c) => c.id), ...BUNDLED_CONTENT.a4.flatMap((s) => s.items.map((p) => p.id))];
  assert.equal(new Set(ids).size, ids.length);
});

test('every bundled formula renders as plain text', () => {
  for (const concept of BUNDLED_CONTENT.a3) {
    if (!concept.formula) continue;
    const text = formulaToText(concept.formula);
    assert.doesNotMatch(text, /[\\{}\u0001\u0002]/, `${concept.id}: ${text}`);
  }
});

test('formula rendering examples', () => {
  assert.equal(formulaToText('\\Delta t\' = \\frac{\\Delta t}{\\sqrt{1 - v^2/c^2}}'), 'Δt\' = Δt/√(1 − v²/c²)');
  assert.equal(formulaToText('\\mathrm{pH} = -\\log_{10} [\\mathrm{H^+}]'), 'pH = −log₁₀[H⁺]');
  assert.equal(formulaToText('\\mathrm{CV}_k = \\frac{1}{k} \\sum_{i=1}^{k} \\mathrm{Err}_i'), 'CVₖ = 1/k Σᵢ₌₁ᵏ Errᵢ');
  assert.equal(formulaToText('\\Delta G = \\Delta H - T \\Delta S'), 'ΔG = ΔH − TΔS');
});
