/**
 * Parses dice expressions like: 2d4+3, 1d4+2d6+2, d20, d100
 * Format: [count]d[sides][kh|kl|kN][+modifier] repeated with + between terms
 *
 * Supported mechanics:
 *   - Basic: d20, 2d6, 2d6+3, 1d20-1d4+2
 *   - Iteration (client-side): "2rr2d20" — rolls 2d20 twice
 *   - Advantage/disadvantage prefix: "adv" → 2d20kh1, "dis" → 2d20kl1
 *     (optional trailing modifier: "adv+5", "dis-2")
 *   - Keep highest/lowest per term: "4d6kh3", "4d6kl1", "4d6k3" (k == kh)
 */

export type DiceKeep = {
  type: "h" | "l";
  count: number;
};

export type DiceTerm = {
  count: number;
  sides: number;
  sign: number; // 1 or -1, for subtraction: 10-2d6, 1d20-1d4
  keep?: DiceKeep; // undefined means keep all
  results?: number[];
};

export type ParsedRoll = {
  terms: DiceTerm[];
  modifier: number;
  expression: string;
};

/**
 * Expands `adv` / `dis` prefix shorthand to canonical form.
 * "adv" → "2d20kh1"; "adv+5" → "2d20kh1+5"; "dis d20+3" → "2d20kl1+3"
 */
function expandAdvantagePrefix(input: string): string {
  const stripped = input.trim().replace(/\s+/g, "");
  const advMatch = /^(adv|dis)(?:d20)?(.*)$/i.exec(stripped);
  if (!advMatch) return stripped;
  const keyword = advMatch[1].toLowerCase();
  const rest = advMatch[2];
  const core = keyword === "adv" ? "2d20kh1" : "2d20kl1";
  return rest ? `${core}${rest}` : core;
}

export function parseDiceExpression(input: string): ParsedRoll | null {
  const expr = expandAdvantagePrefix(input);
  if (!expr || expr.length > 80) return null;

  const terms: DiceTerm[] = [];
  let modifier = 0;
  let i = 0;
  let sign = 1;

  const readKeep = (termCount: number): DiceKeep | null | undefined => {
    // Matches: k3, kh3, kl3 (bare 'k' defaults to 'kh').
    if (expr[i] !== "k" && expr[i] !== "K") return undefined;
    const next = expr[i + 1];
    let type: "h" | "l" = "h";
    let cursor = i + 1;
    if (next === "h" || next === "H") {
      type = "h";
      cursor += 1;
    } else if (next === "l" || next === "L") {
      type = "l";
      cursor += 1;
    }
    let numStr = "";
    while (cursor < expr.length && /[0-9]/.test(expr[cursor])) {
      numStr += expr[cursor];
      cursor += 1;
    }
    if (!numStr) return null; // "k" without a number is invalid
    const keepCount = parseInt(numStr, 10);
    if (!Number.isFinite(keepCount) || keepCount <= 0 || keepCount > termCount) {
      return null;
    }
    i = cursor;
    return { type, count: keepCount };
  };

  while (i < expr.length) {
    if (expr[i] === "+") {
      sign = 1;
      i += 1;
      continue;
    }
    if (expr[i] === "-") {
      sign = -1;
      i += 1;
      continue;
    }

    if (expr[i] === "d" || expr[i] === "D") {
      i += 1;
      let sidesStr = "";
      while (i < expr.length && /[0-9]/.test(expr[i])) {
        sidesStr += expr[i];
        i += 1;
      }
      const sides = sidesStr ? parseInt(sidesStr, 10) : 20;
      if (!Number.isFinite(sides) || sides <= 0) return null;
      const keep = readKeep(1);
      if (keep === null) return null;
      terms.push({ count: 1, sides, sign, keep: keep ?? undefined });
      continue;
    }

    if (!/[0-9]/.test(expr[i])) return null;
    let numStr = "";
    while (i < expr.length && /[0-9]/.test(expr[i])) {
      numStr += expr[i];
      i += 1;
    }
    const num = parseInt(numStr, 10);
    if (!Number.isFinite(num)) return null;

    if ((expr[i] === "d" || expr[i] === "D") && num > 0) {
      i += 1;
      let sidesStr = "";
      while (i < expr.length && /[0-9]/.test(expr[i])) {
        sidesStr += expr[i];
        i += 1;
      }
      const sides = sidesStr ? parseInt(sidesStr, 10) : 20;
      if (!Number.isFinite(sides) || sides <= 0) return null;
      const keep = readKeep(num);
      if (keep === null) return null;
      terms.push({ count: num, sides, sign, keep: keep ?? undefined });
    } else {
      modifier += sign * num;
    }
  }

  if (terms.length === 0 && modifier === 0) return null;

  return {
    terms,
    modifier,
    expression: input.trim(),
  };
}

/**
 * Fair dice roll: each face 1..sides has equal probability.
 * Uses Math.floor(Math.random() * sides) + 1 (correct); avoids ceil which can bias.
 */
export function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

export function executeParsedRoll(parsed: ParsedRoll): { results: number[]; total: number } {
  const allResults: number[] = [];
  let total = parsed.modifier;
  for (const term of parsed.terms) {
    const rolls = rollDice(term.count, term.sides);
    term.results = rolls;

    let contributing: number[] = rolls;
    if (term.keep) {
      // Pick the indexes of the kept rolls (highest or lowest) so we can
      // reorder results as [kept first, then dropped] – useful for display.
      const indexed = rolls.map((value, index) => ({ value, index }));
      indexed.sort((a, b) =>
        term.keep!.type === "h" ? b.value - a.value : a.value - b.value
      );
      const keptSet = new Set(indexed.slice(0, term.keep.count).map((r) => r.index));
      const kept: number[] = [];
      const dropped: number[] = [];
      rolls.forEach((value, index) => {
        if (keptSet.has(index)) kept.push(value);
        else dropped.push(value);
      });
      term.results = [...kept, ...dropped];
      contributing = kept;
      allResults.push(...term.results);
    } else {
      allResults.push(...rolls);
    }

    const termSum = contributing.reduce((a, b) => a + b, 0);
    total += term.sign * termSum;
  }
  return { results: allResults, total };
}

export function formatRollDisplay(
  parsed: ParsedRoll,
  results: number[],
  total: number
): string {
  let idx = 0;
  const parts: string[] = [];
  for (const term of parsed.terms) {
    const slice = results.slice(idx, idx + term.count);
    idx += term.count;
    const prefix = term.sign < 0 ? " - " : (parts.length > 0 ? " + " : "");
    parts.push(`${prefix}${term.count}d${term.sides}: [${slice.join(", ")}]`);
  }
  const modStr = parsed.modifier !== 0
    ? (parsed.modifier > 0 ? ` + ${parsed.modifier}` : ` - ${Math.abs(parsed.modifier)}`)
    : "";
  return `${(parts.length ? parts.join("") : "")}${modStr}${parts.length || parsed.modifier !== 0 ? ` = ${total}` : ""}`.trim() || "0";
}
