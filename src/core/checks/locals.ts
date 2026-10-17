import { Node, SourceFile, Diagnostic } from "ts-morph";
import type { AnalysisContext } from "../context";
import { REPORTED_CODES } from "../constants";
import type {
  DeadRanges,
  DiagnosticsResult,
  FindingKind,
  UnusedFinding,
} from "../types";
import { makeFinding } from "../utils/ast";

function classifyDiagnostic(
  sf: SourceFile,
  start: number,
  code: number,
): FindingKind {
  if (code === 7027) return "unreachable";
  if (code === 6192) return "import";
  if (code === 6138) return "member";

  const parent = sf.getDescendantAtPos(start)?.getParent();
  if (!parent) return "local";

  if (
    Node.isImportDeclaration(parent) ||
    Node.isImportSpecifier(parent) ||
    Node.isImportClause(parent) ||
    Node.isNamespaceImport(parent) ||
    Node.isImportEqualsDeclaration(parent)
  ) {
    return "import";
  }
  if (Node.isParameterDeclaration(parent)) return "parameter";
  if (
    Node.isPropertyDeclaration(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isGetAccessorDeclaration(parent) ||
    Node.isSetAccessorDeclaration(parent)
  ) {
    return "member";
  }
  return "local";
}

/**
 * Chạy TypeScript diagnostics 1 lần (có cache): import / local / parameter / unreachable.
 * Trả thêm `dead` = các khoảng import chết, để check export/member bỏ qua tham chiếu trong đó.
 */
export function getUnusedDiagnostics(ctx: AnalysisContext): DiagnosticsResult {
  if (ctx.diagCache) return ctx.diagCache;

  const findings: UnusedFinding[] = [];
  const dead: DeadRanges = new Map();
  const program = ctx.project.getProgram();
  const files = ctx.getScannableFiles();

  for (let i = 0; i < files.length; i++) {
    const sf = files[i];
    ctx.report(i + 1, files.length, ctx.relPath(sf.getFilePath()));

    let diagnostics: Diagnostic[] = [];
    try {
      diagnostics = program.getSemanticDiagnostics(sf);
    } catch {
      continue;
    }

    for (const d of diagnostics) {
      if (!REPORTED_CODES.has(d.getCode())) continue;

      const start = d.getStart();
      const length = d.getLength();
      if (start === undefined || length === undefined) continue;
      const end = start + length;

      const text = d.getMessageText();
      const message = typeof text === "string" ? text : text.getMessageText();
      const quoted = /'([^']+)'/.exec(message);
      const name = quoted
        ? quoted[1]
        : sf.getFullText().slice(start, end).split(/\r?\n/)[0].slice(0, 60);

      const kind = classifyDiagnostic(sf, start, d.getCode());
      findings.push(makeFinding(sf, name, kind, start, end, message));

      if (kind === "import") {
        const list = dead.get(sf.getFilePath()) ?? [];
        list.push([start, end]);
        dead.set(sf.getFilePath(), list);
      }
    }
  }

  ctx.diagCache = { findings, dead };
  return ctx.diagCache;
}

export function findUnusedLocals(ctx: AnalysisContext): UnusedFinding[] {
  return getUnusedDiagnostics(ctx).findings;
}
