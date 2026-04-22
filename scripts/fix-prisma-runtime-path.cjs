/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const clientIndexPath = path.join(process.cwd(), "node_modules", ".prisma", "client", "index.js");
const brokenImport = "require('@prisma/client/runtime/library.js')";
const fixedImport = "require('../../@prisma/client/runtime/library.js')";

if (!fs.existsSync(clientIndexPath)) {
  console.warn(`[fix-prisma-runtime-path] Skipped: ${clientIndexPath} does not exist`);
  process.exit(0);
}

const original = fs.readFileSync(clientIndexPath, "utf8");

if (!original.includes(brokenImport)) {
  if (original.includes(fixedImport)) {
    console.log("[fix-prisma-runtime-path] Prisma runtime import already patched");
    process.exit(0);
  }
  console.warn("[fix-prisma-runtime-path] Skipped: target import was not found");
  process.exit(0);
}

const patched = original.split(brokenImport).join(fixedImport);
fs.writeFileSync(clientIndexPath, patched);
const replacementCount = original.split(brokenImport).length - 1;
console.log(`[fix-prisma-runtime-path] Patched Prisma runtime import (${replacementCount} replacements)`);
