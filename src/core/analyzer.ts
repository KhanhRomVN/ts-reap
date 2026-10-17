import { AnalysisContext } from "./context";
import type { AnalyzerOptions, CheckKind, UnusedFinding } from "./types";
import { findUnusedFiles } from "./checks/files";
import { findUnusedExports } from "./checks/exports";
import { findUnusedLocals, getUnusedDiagnostics } from "./checks/locals";
import { findUnusedMembers } from "./checks/members";

/** Điều phối các check; logic từng check nằm trong `./checks/*`. */
export class ProjectAnalyzer {
  private readonly ctx: AnalysisContext;

  constructor(options: AnalyzerOptions) {
    this.ctx = new AnalysisContext(options);
  }

  getScannedFileCount(): number {
    return this.ctx.getScannableFiles().length;
  }

  updateFile(filePath: string, content: string): void {
    this.ctx.updateFile(filePath, content);
  }

  refresh(): void {
    this.ctx.refresh();
  }

  findUnusedLocals(): UnusedFinding[] {
    return findUnusedLocals(this.ctx);
  }

  findUnusedExports(): UnusedFinding[] {
    return findUnusedExports(this.ctx);
  }

  findUnusedExportsForFile(filePath: string): UnusedFinding[] {
    return this.findUnusedExports().filter((f) => f.filePath === filePath);
  }

  findUnusedFiles(): UnusedFinding[] {
    return findUnusedFiles(this.ctx);
  }

  findUnusedMembers(): UnusedFinding[] {
    return findUnusedMembers(this.ctx);
  }

  analyze(): UnusedFinding[] {
    const { checks } = this.ctx;
    const needDiagnostics =
      checks.has("locals") || checks.has("exports") || checks.has("members");

    // Các giai đoạn thực sự chạy (để tính tiến trình tổng).
    const stages: CheckKind[] = [];
    if (checks.has("files")) stages.push("files");
    if (needDiagnostics) stages.push("locals");
    if (checks.has("exports")) stages.push("exports");
    if (checks.has("members")) stages.push("members");

    const run = <T>(stage: CheckKind, fn: () => T): T => {
      this.ctx.beginStage(stage, stages.indexOf(stage), stages.length);
      return fn();
    };

    const findings: UnusedFinding[] = [];
    let deadFilePaths = new Set<string>();

    if (checks.has("files")) {
      const fileFindings = run("files", () => this.findUnusedFiles());
      deadFilePaths = new Set(fileFindings.map((f) => f.filePath));
      findings.push(...fileFindings);
    }
    if (needDiagnostics) {
      // Chạy diagnostics 1 lần: export/member cần `dead ranges` từ đây.
      const diag = run("locals", () => getUnusedDiagnostics(this.ctx));
      if (checks.has("locals")) findings.push(...diag.findings);
    }
    if (checks.has("exports")) {
      findings.push(...run("exports", () => this.findUnusedExports()));
    }
    if (checks.has("members")) {
      findings.push(...run("members", () => this.findUnusedMembers()));
    }

    // File đã chết hoàn toàn thì export/member bên trong chỉ là nhiễu.
    return findings
      .filter(
        (f) =>
          !(
            deadFilePaths.has(f.filePath) &&
            (f.kind === "export" || f.kind === "member")
          ),
      )
      .sort(
        (a, b) =>
          a.filePath.localeCompare(b.filePath) ||
          a.startLine - b.startLine ||
          a.startChar - b.startChar,
      );
  }

  dispose(): void {
    // ts-morph Project has no explicit dispose; drop the reference for GC.
  }
}
