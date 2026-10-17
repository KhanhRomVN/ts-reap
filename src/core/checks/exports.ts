import { Node } from "ts-morph";
import type { AnalysisContext } from "../context";
import type { UnusedFinding } from "../types";
import { getNameNodeOf, makeFinding } from "../utils/ast";
import { getUnusedDiagnostics } from "./locals";

export function findUnusedExports(ctx: AnalysisContext): UnusedFinding[] {
  const findings: UnusedFinding[] = [];
  const files = ctx.getScannableFiles();
  const publicFiles = ctx.collectPublicApiFiles(files);
  const dead = getUnusedDiagnostics(ctx).dead;

  for (let i = 0; i < files.length; i++) {
    const sf = files[i];
    ctx.report(i + 1, files.length, ctx.relPath(sf.getFilePath()));

    if (ctx.isEntryFile(sf) || publicFiles.has(sf.getFilePath())) continue;

    let exported: ReadonlyMap<string, Node[]> = new Map();
    try {
      exported = sf.getExportedDeclarations();
    } catch {
      continue;
    }

    const reported = new Set<string>();

    for (const [name, declarations] of exported) {
      if (reported.has(name)) continue;

      for (const decl of declarations) {
        // Bỏ qua re-export (declaration nằm ở file khác).
        if (decl.getSourceFile() !== sf) continue;
        if (!Node.isReferenceFindable(decl)) continue;

        let references: Node[] = [];
        try {
          references = decl.findReferencesAsNodes();
        } catch {
          continue;
        }

        const { external, local } = ctx.countReferences(decl, references, dead);
        
        // Nếu có reference bên ngoài -> OK
        if (external > 0) break;
        
        // Nếu có reference bên trong (local > 0) -> Coi như đã dùng, bỏ qua không flag
        // Yêu cầu: chỉ liệt kê thành phần thực sự KO DÙNG (kể cả ko dùng nội bộ)
        if (local > 0) continue;

        const target = getNameNodeOf(decl) ?? decl;
        const message = `Exported "${name}" is never used anywhere in the scanned scope (re-exports excluded).`;

        findings.push(
          makeFinding(
            sf,
            name,
            "export",
            target.getStart(),
            target.getEnd(),
            message,
          ),
        );
        reported.add(name);
        break;
      }
    }
  }

  return findings;
}
