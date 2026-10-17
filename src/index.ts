/**
 * Main entry point for @khanhromvn/ts-reap package
 * Exports analyzer và các types để dùng programmatically
 */
export * from "./core/analyzer";
export type {
  UnusedFinding,
  AnalyzerOptions,
  FindingKind,
  CheckKind,
  ProgressEvent,
  ProgressListener,
} from "./core/types";
export {
  ALL_CHECKS,
  DEFAULT_ENTRY_PATTERNS,
  DEFAULT_IGNORE_PATTERNS,
} from "./core/constants";
export { normalizePath } from "./core/utils/path";
