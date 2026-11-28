/**
 * Renders the LaTeX formulas of A3 concepts as plain Unicode text, so they display with
 * the system font and no web view. Covers the commands used by the content set (checked
 * by tests/formula_text.test.ts against every bundled formula); anything unknown falls
 * back to the command name without its backslash.
 */
const EM_SPACE = '\u2003';
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', vartheta: 'ϑ', varphi: 'φ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  hbar: 'ħ', nabla: '∇', partial: '∂', infty: '∞', cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓',
  approx: '≈', neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥', ll: '≪', gg: '≫', sim: '∼', propto: '∝',
  equiv: '≡', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', rightleftharpoons: '⇌',
  leftrightarrow: '↔', sum: 'Σ', prod: 'Π', int: '∫', circ: '∘', top: 'ᵀ', mid: '|', lVert: '‖', rVert: '‖',
  Vert: '‖', '|': '‖', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', forall: '∀',
  exists: '∃', ldots: '…', cdots: '⋯', dots: '…', star: '⋆', ast: '∗', langle: '⟨', rangle: '⟩',
  quad: EM_SPACE, qquad: EM_SPACE, ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '{': '{', '}': '}', '%': '%', '_': '_',
};

/** Commands whose single argument is shown as-is (fonts and text wrappers). */
const PASS_THROUGH = new Set(['mathrm', 'mathbf', 'mathit', 'mathsf', 'operatorname', 'boldsymbol', 'bm']);
/** Text wrappers: their spaces are kept. */
const TEXT_MODE = new Set(['text', 'textrm', 'mbox']);
/** Operator names, set upright with a space on each side that touches a letter or digit. */
const OPERATOR_NAMES = new Set(['ln', 'log', 'exp', 'sin', 'cos', 'tan', 'max', 'min', 'lim', 'det', 'arg', 'sup', 'inf']);
/** Large operators: their limits attach, then a space separates the summand. */
const LARGE_OPERATORS: Record<string, string> = { sum: 'Σ', prod: 'Π', int: '∫' };
/** Characters typeset with a space on each side when they join two terms. */
const BINARY = new Set(['=', '+', '−', '*', '×', '·', '≈', '≤', '≥', '≠', '∼', '⇌', '→', '←', '⇒', '↔', '∝', '≡', '|', '∈']);
/** Sizing and spacing commands that print nothing. */
const IGNORED = new Set(['big', 'Big', 'bigg', 'Bigg', 'left', 'right', 'displaystyle', 'limits', 'nolimits']);

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', T: 'ᵀ', ᵀ: 'ᵀ', '∘': '°',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ',
  o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};
const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ',
  l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

const DOUBLE_STRUCK: Record<string, string> = { E: '𝔼', R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ' };
const CALLIGRAPHIC: Record<string, string> = { E: 'ℰ', L: 'ℒ', F: 'ℱ', H: 'ℋ', B: 'ℬ', M: 'ℳ', N: '𝒩', O: '𝒪' };

class Reader {
  index = 0;
  constructor(readonly source: string) {}
  get done() {
    return this.index >= this.source.length;
  }
  peek() {
    return this.source[this.index] ?? '';
  }
  next() {
    const char = this.source[this.index] ?? '';
    this.index += 1;
    return char;
  }
  skipSpaces() {
    while (this.peek() === ' ') this.index += 1;
  }
}

/** Reads one argument: a {group} or a single token. */
function readArgument(reader: Reader, textMode = false): string {
  reader.skipSpaces();
  if (reader.peek() === '{') {
    reader.next();
    return renderUntil(reader, '}', textMode);
  }
  if (reader.peek() === '\\') {
    reader.next();
    return renderCommand(reader);
  }
  return reader.next();
}

function readRawGroup(reader: Reader): string {
  reader.skipSpaces();
  if (reader.peek() !== '{') return reader.next();
  reader.next();
  let depth = 1;
  let out = '';
  while (!reader.done) {
    const char = reader.next();
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    out += char;
  }
  return out;
}

/** Ends a plain-text subscript or superscript, so a letter right after it gets a space. */
const SCRIPT_END = '\u0002';

function needsParentheses(text: string): boolean {
  if (/^√\(.*\)$/.test(text.trim())) return false;
  return /[\s+\-−·×/=,∼|∈]/.test(text.trim()) && !/^\(.*\)$/.test(text.trim());
}

function script(raw: string, table: Record<string, string>, marker: string): string {
  const text = raw.trim();
  if (text === '1/2' && marker === '_') return '½';
  const chars = [...text];
  if (chars.length > 0 && chars.every((char) => table[char] !== undefined)) return chars.map((char) => table[char]).join('');
  return needsParentheses(text) ? `${marker}(${text})` : `${marker}${text}${SCRIPT_END}`;
}

/** Reads the ^ and _ limits that follow a large operator. */
function readLimits(reader: Reader): string {
  let out = '';
  for (;;) {
    reader.skipSpaces();
    const char = reader.peek();
    if (char === '^') {
      reader.next();
      out += script(readArgument(reader), SUPERSCRIPT, '^');
    } else if (char === '_') {
      reader.next();
      out += script(readArgument(reader), SUBSCRIPT, '_');
    } else {
      return out;
    }
  }
}

function renderCommand(reader: Reader): string {
  let name = '';
  if (/[A-Za-z]/.test(reader.peek())) {
    while (/[A-Za-z]/.test(reader.peek())) name += reader.next();
  } else {
    name = reader.next();
  }
  if (IGNORED.has(name)) return '';
  if (PASS_THROUGH.has(name)) return readArgument(reader);
  if (TEXT_MODE.has(name)) return readArgument(reader, true);
  if (OPERATOR_NAMES.has(name)) {
    reader.skipSpaces();
    return `${OPERATOR_START}${name}${/[A-Za-z0-9\\]/.test(reader.peek()) ? ' ' : ''}`;
  }
  const large = LARGE_OPERATORS[name];
  if (large) return `${OPERATOR_START}${large}${readLimits(reader)} `;
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    const top = readArgument(reader);
    const bottom = readArgument(reader);
    const wrap = (text: string) => (needsParentheses(text) ? `(${text.trim()})` : text.trim());
    return `${wrap(top)}/${wrap(bottom)}`;
  }
  if (name === 'sqrt') {
    const arg = readArgument(reader);
    return `√${needsParentheses(arg) ? `(${arg})` : arg}`;
  }
  if (name === 'hat') return `${readArgument(reader)}̂`;
  if (name === 'bar' || name === 'overline') return `${readArgument(reader)}̅`;
  if (name === 'vec') return `${readArgument(reader)}⃗`;
  if (name === 'tilde') return `${readArgument(reader)}̃`;
  if (name === 'dot') return `${readArgument(reader)}̇`;
  if (name === 'mathbb') return [...readRawGroup(reader)].map((char) => DOUBLE_STRUCK[char] ?? char).join('');
  if (name === 'mathcal') return [...readRawGroup(reader)].map((char) => CALLIGRAPHIC[char] ?? char).join('');
  const symbol = SYMBOLS[name];
  return symbol !== undefined ? symbol : name;
}

/** Marks where an operator name starts, so a space can be added if it touches the previous term. */
const OPERATOR_START = '\u0001';

function renderUntil(reader: Reader, terminator: string | null, textMode = false): string {
  let out = '';
  while (!reader.done) {
    const char = reader.peek();
    if (terminator !== null && char === terminator) {
      reader.next();
      return out;
    }
    reader.next();
    // Math mode ignores source spaces; spacing is added around operators afterwards.
    if (char === ' ' && !textMode) continue;
    if (char === '\\') out += renderCommand(reader);
    else if (char === '{') out += renderUntil(reader, '}', textMode);
    else if (char === '^') out += script(readArgument(reader), SUPERSCRIPT, '^');
    else if (char === '_') out += script(readArgument(reader), SUBSCRIPT, '_');
    else if (char === '~') out += ' ';
    else if (char === '-') out += '−';
    else out += char;
  }
  return out;
}

const OPENING = new Set(['(', '[', '{', '⟨', '^', '_', ',', EM_SPACE, '', ' ']);

/** Adds spaces around binary operators and relations, and after commas, as LaTeX does. */
function spaceOperators(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? '';
    const previous = out.trimEnd().slice(-1);
    if (char === SCRIPT_END) {
      if (/[\p{L}\p{N}]/u.test(chars[i + 1] ?? '')) out += ' ';
      continue;
    }
    if (char === OPERATOR_START) {
      if (/[A-Za-z0-9)\]‖ᵀ²³⁰-⁹₀-₉]/.test(previous)) out += ' ';
      continue;
    }
    if (BINARY.has(char)) {
      const unary = OPENING.has(previous) || BINARY.has(previous);
      out = unary ? out : `${out.trimEnd()} `;
      out += char;
      if (!unary) out += ' ';
      continue;
    }
    if (char === ',') {
      out = `${out.trimEnd()}, `;
      continue;
    }
    out += char;
  }
  return out;
}

/** Commands handled by renderCommand outside the tables above. */
const STRUCTURAL = new Set(['frac', 'dfrac', 'tfrac', 'sqrt', 'hat', 'bar', 'overline', 'vec', 'tilde', 'dot', 'mathbb', 'mathcal']);

/** Letter commands in a formula that the renderer does not know, and would print as their bare name. */
export function unsupportedFormulaCommands(latex: string): string[] {
  const names = [...latex.matchAll(/\\([A-Za-z]+)/g)].map((match) => match[1] ?? '');
  return names.filter(
    (name) =>
      SYMBOLS[name] === undefined &&
      !PASS_THROUGH.has(name) &&
      !TEXT_MODE.has(name) &&
      !OPERATOR_NAMES.has(name) &&
      LARGE_OPERATORS[name] === undefined &&
      !IGNORED.has(name) &&
      !STRUCTURAL.has(name),
  );
}

export function formulaToText(latex: string): string {
  return spaceOperators(renderUntil(new Reader(latex), null))
    .replace(/ +/g, ' ')
    .replace(/ *\u2003 */g, '\u2003')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]},])/g, '$1')
    .replace(/,\u2003/g, ',\u2003')
    .trim();
}
