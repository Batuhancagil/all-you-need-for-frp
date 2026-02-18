/**
 * Parses dice expressions like: 2d4+3, 1d4+2d6+2, d20, d100
 * Format: [count]d[sides][+modifier] repeated with + between terms
 */

export type DiceTerm = {
  count: number;
  sides: number;
  sign: number; // 1 or -1, for subtraction: 10-2d6, 1d20-1d4
  results?: number[];
};

export type ParsedRoll = {
  terms: DiceTerm[];
  modifier: number;
  expression: string;
};

export function parseDiceExpression(input: string): ParsedRoll | null {
  const expr = input.trim().replace(/\s+/g, "");
  if (!expr || expr.length > 80) return null;

  const terms: DiceTerm[] = [];
  let modifier = 0;
  let i = 0;
  let sign = 1;

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
      terms.push({ count: 1, sides, sign });
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
      terms.push({ count: num, sides, sign });
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
    allResults.push(...rolls);
    const termSum = rolls.reduce((a, b) => a + b, 0);
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
