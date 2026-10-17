import { Project, SourceFile, Node, ts } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import {
  DEFAULT_ENTRY_PATTERNS,
  DEFAULT_IGNORE_PATTERNS,
  EXCLUDE_GLOBS,
  SOURCE_EXT_GLOB,
  ALL_CHECKS,
} from "./constants";
import type {
  AnalyzerOptions,
  CheckKind,
  DeadRanges,
  DiagnosticsResult,
} from "./types";
import { normalizePath } from "./utils/path";
import { compilePatterns, readGitignorePatterns } from "./utils/patterns";
import { isInRanges } from "./utils/ast";

/**
 * Trạng thái dùng chung cho mọi check: project ts-morph, scope, pattern ignore/entry,
 * các hàm tiện ích truy vấn file và bộ đếm tham chiếu.
 */
export class AnalysisContext {
  readonly project: Project;
  readonly root: string;
  readonly checks: Set<CheckKind>;
  /** Cache kết quả diagnostics (locals + dead import ranges). */
  diagCache: DiagnosticsResult | undefined;

  private readonly options: AnalyzerOptions;
  private readonly hasScope: boolean;
  private readonly scopeAbs: string[];
  private readonly ignoreRegexes: RegExp[];
  private readonly entryRegexes: RegExp[];
  private readonly openFiles = new Set<string>();
  private stageInfo: { stage: CheckKind; index: number; count: number } | undefined;

  constructor(options: AnalyzerOptions) {
    this.options = options;
    this.checks = new Set<CheckKind>(
      options.checks && options.checks.length > 0 ? options.checks : ALL_CHECKS,
    );
    this.root = normalizePath(
      options.tsConfigFilePath
        ? path.dirname(options.tsConfigFilePath)
        : path.resolve(options.rootDir ?? process.cwd()),
    );

    this.hasScope = !!options.scopePaths && options.scopePaths.length > 0;
    const scopes = this.hasScope
      ? (options.scopePaths as string[])
      : [this.root];
    this.scopeAbs = scopes.map((p) =>
      normalizePath(path.isAbsolute(p) ? p : path.join(this.root, p)).replace(
        /\/+$/,
        "",
      ),
    );

    this.ignoreRegexes = compilePatterns([
      ...(options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS),
      ...readGitignorePatterns(this.root),
    ]);
    this.entryRegexes = compilePatterns(
      options.entryPatterns ?? DEFAULT_ENTRY_PATTERNS,
    );

    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      skipLibCheck: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      allowUnreachableCode: false,
      allowUnusedLabels: false,
    };
    if (!options.tsConfigFilePath) {
      compilerOptions.jsx = ts.JsxEmit.ReactJSX;
      compilerOptions.target = ts.ScriptTarget.ESNext;
      compilerOptions.module = ts.ModuleKind.CommonJS;
      compilerOptions.esModuleInterop = true;
    }

    this.project = new Project({
      ...(options.tsConfigFilePath
        ? { tsConfigFilePath: options.tsConfigFilePath }
        : {}),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions,
    });

    this.loadFiles();
  }

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  beginStage(stage: CheckKind, index: number, count: number): void {
    this.stageInfo = { stage, index, count };
    this.options.onProgress?.({
      stage,
      stageIndex: index,
      stageCount: count,
      current: 0,
      total: 1,
    });
  }

  report(current: number, total: number, file?: string): void {
    const info = this.stageInfo;
    if (!info || !this.options.onProgress) return;
    this.options.onProgress({
      stage: info.stage,
      stageIndex: info.index,
      stageCount: info.count,
      current,
      total,
      file,
    });
  }

  // ---------------------------------------------------------------------------
  // Project / file management
  // ---------------------------------------------------------------------------

  private loadFiles(): void {
    if (!this.hasScope && this.options.tsConfigFilePath) {
      this.project.addSourceFilesFromTsConfig(this.options.tsConfigFilePath);
      return;
    }
    this.project.addSourceFilesAtPaths([
      ...this.scopeAbs.map((p) => this.toGlob(p)),
      ...EXCLUDE_GLOBS,
    ]);
  }

  private toGlob(abs: string): string {
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return `${abs}/${SOURCE_EXT_GLOB}`;
    }
    return abs;
  }

  updateFile(filePath: string, content: string): void {
    this.openFiles.add(normalizePath(filePath));
    this.diagCache = undefined;
    const existing = this.project.getSourceFile(filePath);
    if (existing) {
      existing.replaceWithText(content);
    } else {
      this.project.createSourceFile(filePath, content, { overwrite: true });
    }
  }

  refresh(): void {
    this.loadFiles();
    for (const sf of this.project.getSourceFiles()) {
      if (!this.isInScope(sf)) continue;
      // File đang mở trong editor: nội dung trong bộ nhớ mới là nguồn đúng, không đọc đè từ disk.
      if (this.openFiles.has(sf.getFilePath())) continue;
      sf.refreshFromFileSystemSync();
    }
    this.diagCache = undefined;
  }

  // ---------------------------------------------------------------------------
  // File queries
  // ---------------------------------------------------------------------------

  relPath(filePath: string): string {
    return path.relative(this.root, filePath).split(path.sep).join("/");
  }

  isIgnored(filePath: string): boolean {
    const rel = this.relPath(filePath);
    return this.ignoreRegexes.some((re) => re.test(rel));
  }

  isInScope(sf: SourceFile): boolean {
    const fp = sf.getFilePath() as string;
    return this.scopeAbs.some((s) => fp === s || fp.startsWith(s + "/"));
  }

  isEntryFile(sf: SourceFile): boolean {
    const rel = this.relPath(sf.getFilePath());
    return this.entryRegexes.some((re) => re.test(rel));
  }

  getScannableFiles(): SourceFile[] {
    return this.project
      .getSourceFiles()
      .filter((sf) => this.isInScope(sf))
      .filter((sf) => !this.isIgnored(sf.getFilePath()));
  }

  /** File được `export * from` bởi entry (đệ quy) => toàn bộ export của nó là API public. */
  collectPublicApiFiles(files: SourceFile[]): Set<string> {
    const result = new Set<string>();
    const stack = files.filter((sf) => this.isEntryFile(sf));

    while (stack.length > 0) {
      const current = stack.pop() as SourceFile;
      for (const exportDecl of current.getExportDeclarations()) {
        if (exportDecl.hasNamedExports()) continue;
        const target = exportDecl.getModuleSpecifierSourceFile();
        if (!target) continue;
        const targetPath = target.getFilePath() as string;
        if (result.has(targetPath)) continue;
        result.add(targetPath);
        stack.push(target);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Reference counting (dùng cho export + member)
  // ---------------------------------------------------------------------------

  countReferences(
    decl: Node,
    references: Node[],
    dead: DeadRanges,
  ): { external: number; local: number } {
    const declSf = decl.getSourceFile();
    const declStart = decl.getPos();
    const declEnd = decl.getEnd();
    let external = 0;
    let local = 0;

    for (const ref of references) {
      const refSf = ref.getSourceFile();
      const refPath = refSf.getFilePath() as string;

      if (!this.isInScope(refSf) || this.isIgnored(refPath)) continue;
      if (isInRanges(dead.get(refPath), ref.getStart())) continue;

      const parent = ref.getParent();
      if (parent && Node.isExportAssignment(parent)) continue;
      if (parent && Node.isExportSpecifier(parent)) {
        const isReExport = parent.getExportDeclaration().hasModuleSpecifier();
        // `export { x }` nội bộ không phải là "dùng".
        if (!isReExport) continue;
        // Re-export chỉ được tính là dùng khi nằm ở file entry (API public).
        if (!this.isEntryFile(refSf)) continue;
      }

      if (refSf === declSf) {
        // Tự tham chiếu bên trong chính declaration (đệ quy...) không tính.
        if (ref.getStart() >= declStart && ref.getEnd() <= declEnd) continue;
        local++;
      } else {
        external++;
      }
    }

    return { external, local };
  }
}
