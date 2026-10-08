/**
 * Main entry point for @khanhromvn/ts-reap package
 * Exports analyzer và các types để dùng programmatically
 */
export {
  ProjectAnalyzer,
  UnusedFinding,
  AnalyzerOptions,
  FindingKind,
  CheckKind,
  ALL_CHECKS,
  DEFAULT_ENTRY_PATTERNS,
  DEFAULT_IGNORE_PATTERNS,
} from "./analyzer";
export { normalizePath } from "./analyzer";
