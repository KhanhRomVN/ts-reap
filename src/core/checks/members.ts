import { Node, SyntaxKind } from "ts-morph";
import type { AnalysisContext } from "../context";
import type { UnusedFinding } from "../types";
import { getNameNodeOf, makeFinding } from "../utils/ast";
import { getUnusedDiagnostics } from "./locals";

export function findUnusedMembers(ctx: AnalysisContext): UnusedFinding[] {
  const findings: UnusedFinding[] = [];
  const files = ctx.getScannableFiles();
  const publicFiles = ctx.collectPublicApiFiles(files);
  const dead = getUnusedDiagnostics(ctx).dead;

  for (let i = 0; i < files.length; i++) {
    const sf = files[i];
    ctx.report(i + 1, files.length, ctx.relPath(sf.getFilePath()));

    if (ctx.isEntryFile(sf) || publicFiles.has(sf.getFilePath())) continue;

    const candidates: Array<{ owner: string; member: Node }> = [];

    for (const cls of sf.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
      // Class kế thừa/implement: member có thể được gọi gián tiếp => bỏ qua cho an toàn.
      if (cls.getExtends() || cls.getImplements().length > 0) continue;
      const owner = cls.getName() ?? "(anonymous class)";

      for (const m of cls.getMembers()) {
        if (
          !(
            Node.isPropertyDeclaration(m) ||
            Node.isMethodDeclaration(m) ||
            Node.isGetAccessorDeclaration(m) ||
            Node.isSetAccessorDeclaration(m)
          )
        ) {
          continue;
        }
        // private đã được TypeScript báo ở check locals.
        if (m.hasModifier(SyntaxKind.PrivateKeyword)) continue;
        if (m.getDecorators().length > 0) continue;
        candidates.push({ owner, member: m });
      }
    }

    for (const itf of sf.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration)) {
      for (const m of itf.getMembers()) {
        if (Node.isPropertySignature(m) || Node.isMethodSignature(m)) {
          candidates.push({ owner: itf.getName(), member: m });
        }
      }
    }

    for (const en of sf.getDescendantsOfKind(SyntaxKind.EnumDeclaration)) {
      for (const m of en.getMembers()) {
        candidates.push({ owner: en.getName(), member: m });
      }
    }

    for (const { owner, member } of candidates) {
      const nameNode = getNameNodeOf(member);
      if (!nameNode || !Node.isIdentifier(nameNode)) continue;

      let references: Node[] = [];
      try {
        references = nameNode.findReferencesAsNodes();
      } catch {
        continue;
      }

      const { external, local } = ctx.countReferences(member, references, dead);
      if (external + local > 0) continue;

      const name = nameNode.getText();
      findings.push(
        makeFinding(
          sf,
          `${owner}.${name}`,
          "member",
          nameNode.getStart(),
          nameNode.getEnd(),
          `Member "${owner}.${name}" is never used in the scanned scope.`,
        ),
      );
    }
  }

  return findings;
}
