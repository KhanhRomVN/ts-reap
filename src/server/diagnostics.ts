import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import type { UnusedFinding } from "../core/types";

export function toDiagnostic(finding: UnusedFinding): Diagnostic {
  return {
    severity: DiagnosticSeverity.Warning,
    range: {
      start: { line: finding.startLine, character: finding.startChar },
      end: { line: finding.endLine, character: finding.endChar },
    },
    message: finding.message,
    source: "ts-reap",
  };
}
