#!/usr/bin/env node
/**
 * Quick test for dice parser: expressions, subtraction, distribution
 */
import { parseDiceExpression, executeParsedRoll, formatRollDisplay } from "../src/server/dice-parser.ts";

console.log("=== Dice roll tests ===\n");

// 1. Basic expressions
const basic = ["d20", "2d6", "2d4+3", "1d4+2d6+2", "d100"];
for (const expr of basic) {
  const p = parseDiceExpression(expr);
  if (!p) {
    console.log("FAIL:", expr, "- parse failed");
    continue;
  }
  const r = executeParsedRoll(JSON.parse(JSON.stringify(p)));
  const display = formatRollDisplay(p, r.results, r.total);
  console.log(expr.padEnd(12), "→", display);
}

// 2. Subtraction
console.log("\n--- Subtraction ---");
const sub = [
  ["10-2d6", 8, -2],   // range 10-2 to 10-12
  ["1d20-1d4", 19, -3], // range 20-1 to 1-4
  ["2d6-1d4", 11, 1],   // range 12-1 to 2-4
];
for (const [expr, maxExpected, minExpected] of sub) {
  const p = parseDiceExpression(expr);
  if (!p) {
    console.log("FAIL:", expr, "- parse failed");
    continue;
  }
  const r = executeParsedRoll(JSON.parse(JSON.stringify(p)));
  const inRange = r.total >= minExpected && r.total <= maxExpected;
  console.log(expr.padEnd(12), "→", formatRollDisplay(p, r.results, r.total), inRange ? "✓" : "⚠ range check");
}

// 3. Distribution sample (d6)
console.log("\n--- d6 distribution (6k rolls) ---");
const counts = {};
for (let i = 0; i < 6000; i++) {
  const p = parseDiceExpression("d6");
  const r = executeParsedRoll(JSON.parse(JSON.stringify(p)));
  const v = r.results[0];
  counts[v] = (counts[v] || 0) + 1;
}
console.log(counts);
const dev = Object.values(counts).map((c) => Math.abs(c - 1000) / 1000);
console.log("Max deviation:", (Math.max(...dev) * 100).toFixed(1) + "%", Math.max(...dev) < 0.1 ? "✓" : "⚠");

console.log("\nDone.");
