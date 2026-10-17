import * as path from "path";
import type { SourceFile } from "ts-morph";
import type { AnalysisContext } from "../context";
import type { UnusedFinding } from "../types";

export function findUnusedFiles(ctx: AnalysisContext): UnusedFinding[] {
  const files = ctx.getScannableFiles();
  const pool = new Set<string>(files.map((sf) => sf.getFilePath() as string));
  const importers = new Map<string, Set<string>>();
  const imports = new Map<string, Set<string>>();

  for (let i = 0; i < files.length; i++) {
    const sf = files[i];
    const from = sf.getFilePath() as string;
    ctx.report(i + 1, files.length, ctx.relPath(from));

    let referenced: SourceFile[] = [];
    try {
      referenced = sf.getReferencedSourceFiles();
    } catch {
      continue;
    }

    for (const target of referenced) {
      const to = target.getFilePath() as string;
      if (to === from || !pool.has(to)) continue;

      if (!importers.has(to)) importers.set(to, new Set());
      (importers.get(to) as Set<string>).add(from);

      if (!imports.has(from)) imports.set(from, new Set());
      (imports.get(from) as Set<string>).add(to);
    }
  }

  // Bước 1: file không còn importer "sống" nào => chết (lan truyền theo chuỗi).
  const deadFiles = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const sf of files) {
      const fp = sf.getFilePath() as string;
      if (deadFiles.has(fp) || ctx.isEntryFile(sf)) continue;
      const alive = Array.from(importers.get(fp) ?? []).filter(
        (p) => !deadFiles.has(p),
      );
      if (alive.length === 0) {
        deadFiles.add(fp);
        changed = true;
      }
    }
  }

  // Bước 2: nếu có entry, mọi file không với tới được từ entry cũng chết (bắt vòng lặp import).
  const roots = files.filter((sf) => ctx.isEntryFile(sf));
  if (roots.length > 0) {
    const reached = new Set<string>();
    const stack = roots.map((sf) => sf.getFilePath() as string);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (reached.has(current)) continue;
      reached.add(current);
      for (const next of imports.get(current) ?? []) stack.push(next);
    }
    for (const sf of files) {
      const fp = sf.getFilePath() as string;
      if (!reached.has(fp)) deadFiles.add(fp);
    }
  }

  const findings: UnusedFinding[] = [];
  for (const sf of files) {
    const fp = sf.getFilePath() as string;
    if (!deadFiles.has(fp)) continue;

    const neverImported = (importers.get(fp)?.size ?? 0) === 0;
    const firstLine = sf.getFullText().split(/\r?\n/, 1)[0];
    findings.push({
      filePath: fp,
      name: path.basename(fp),
      kind: "file",
      startLine: 0,
      startChar: 0,
      endLine: 0,
      endChar: Math.max(firstLine.length, 1),
      message: neverImported
        ? "File is never imported anywhere in the scanned scope."
        : "File is only reachable from unused files (dead code chain or circular imports).",
    });
  }

  return findings;
}
