import type { CheckKind } from "./types";

export const ALL_CHECKS: CheckKind[] = [
  "files",
  "exports",
  "locals",
  "members",
];

/** Entry points: file nằm trong list này không bị coi là "unused file" và export của nó là API public. */
export const DEFAULT_ENTRY_PATTERNS = [
  "/index.*",
  "/main.*",
  "main.*",
  "src/index.*",
  "src/main.*",
  "*.config.*",
  "*.test.*",
  "*.spec.*",
  "*.stories.*",
  "__tests__",
  "__mocks__",
];

export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  "*.d.ts",
  "dist",
  "build",
  "coverage",
];

export const EXCLUDE_GLOBS = ["!**/node_modules/**", "!**/*.d.ts"];
export const SOURCE_EXT_GLOB = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}";

/** Các mã diagnostic của TypeScript liên quan tới "unused" / "unreachable". */
export const REPORTED_CODES = new Set([
  6133, 6138, 6192, 6196, 6198, 6199, 6205, 7027, 7028,
]);
