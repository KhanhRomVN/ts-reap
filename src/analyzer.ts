import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  Diagnostic,
  ts,
} from "ts-morph";
import * as path from "path";
import * as fs from "fs";

//cc

export type FindingKind =
  | "file"
  | "export"
  | "import"
  | "local"
  | "parameter"
  | "member"
  | "unreachable";

export type CheckKind = "files" | "exports" | "locals" | "members";

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

const EXCLUDE_GLOBS = ["!**/node_modules/**", "!**/*.d.ts"];
const SOURCE_EXT_GLOB = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}";

/** Các mã diagnostic của TypeScript liên quan tới "unused" / "unreachable". */
const REPORTED_CODES = new Set([
  6133, 6138, 6192, 6196, 6198, 6199, 6205, 7027, 7028,
]);

type DeadRanges = Map<string, Array<[number, number]>>;

export interface UnusedFinding {
  filePath: string;
  name: string;
  kind: FindingKind;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  message: string;
}

export interface AnalyzerOptions {
  /** Absolute path to tsconfig.json (optional; nếu không có sẽ dùng compiler options mặc định). */
  tsConfigFilePath?: string;
  /** Thư mục gốc khi không có tsconfig (mặc định: cwd). */
  rootDir?: string;
  /** Glob patterns (relative to project root) treated as entry points. */
  entryPatterns?: string[];
  /** Skip patterns (thay thế mặc định, .gitignore luôn được cộng thêm). */
  ignorePatterns?: string[];
  /** Files/folders to scan. If omitted, all files from tsconfig (hoặc rootDir) are scanned. */
  scopePaths?: string[];
  /** Nhóm kiểm tra cần chạy. Mặc định: tất cả. */
  checks?: CheckKind[];
}

export class ProjectAnalyzer {
  private project: Project;
  private options: AnalyzerOptions;
  private root: string;
  private hasScope: boolean;
  private scopeAbs: string[];
  private checks: Set<CheckKind>;
  private ignoreRegexes: RegExp[];
  private entryRegexes: RegExp[];
  private openFiles = new Set<string>();
  private diagCache:
    | { findings: UnusedFinding[]; dead: DeadRanges }
    | undefined;

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

  private relPath(filePath: string): string {
    return path.relative(this.root, filePath).split(path.sep).join("/");
  }

  private isIgnored(filePath: string): boolean {
    const rel = this.relPath(filePath);
    return this.ignoreRegexes.some((re) => re.test(rel));
  }

  private isInScope(sf: SourceFile): boolean {
    const fp = sf.getFilePath() as string;
    return this.scopeAbs.some((s) => fp === s || fp.startsWith(s + "/"));
  }

  private isEntryFile(sf: SourceFile): boolean {
    const rel = this.relPath(sf.getFilePath());
    return this.entryRegexes.some((re) => re.test(rel));
  }

  private getScannableFiles(): SourceFile[] {
    return this.project
      .getSourceFiles()
      .filter((sf) => this.isInScope(sf))
      .filter((sf) => !this.isIgnored(sf.getFilePath()));
  }

  /** File được `export * from` bởi entry (đệ quy) => toàn bộ export của nó là API public. */
  private collectPublicApiFiles(files: SourceFile[]): Set<string> {
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

  private countReferences(
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

  // ---------------------------------------------------------------------------
  // 1) TypeScript diagnostics: import / local / parameter / unreachable
  // ---------------------------------------------------------------------------

  private classifyDiagnostic(
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

  private getUnusedDiagnostics(): {
    findings: UnusedFinding[];
    dead: DeadRanges;
  } {
    if (this.diagCache) return this.diagCache;

    const findings: UnusedFinding[] = [];
    const dead: DeadRanges = new Map();
    const program = this.project.getProgram();

    for (const sf of this.getScannableFiles()) {
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

        const kind = this.classifyDiagnostic(sf, start, d.getCode());
        findings.push(makeFinding(sf, name, kind, start, end, message));

        if (kind === "import") {
          const list = dead.get(sf.getFilePath()) ?? [];
          list.push([start, end]);
          dead.set(sf.getFilePath(), list);
        }
      }
    }

    this.diagCache = { findings, dead };
    return this.diagCache;
  }

  findUnusedLocals(): UnusedFinding[] {
    return this.getUnusedDiagnostics().findings;
  }

  // ---------------------------------------------------------------------------
  // 2) Unused exports
  // ---------------------------------------------------------------------------

  findUnusedExports(): UnusedFinding[] {
    const findings: UnusedFinding[] = [];
    const files = this.getScannableFiles();
    const publicFiles = this.collectPublicApiFiles(files);
    const dead = this.getUnusedDiagnostics().dead;

    for (const sf of files) {
      if (this.isEntryFile(sf) || publicFiles.has(sf.getFilePath())) continue;

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

          const { external, local } = this.countReferences(
            decl,
            references,
            dead,
          );
          if (external > 0) break;

          const target = getNameNodeOf(decl) ?? decl;
          const message =
            local > 0
              ? `Exported "${name}" is only used inside its own file; remove the "export" keyword.`
              : `Exported "${name}" is never used anywhere in the scanned scope (re-exports excluded).`;

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

  findUnusedExportsForFile(filePath: string): UnusedFinding[] {
    return this.findUnusedExports().filter((f) => f.filePath === filePath);
  }

  // ---------------------------------------------------------------------------
  // 3) Unused files
  // ---------------------------------------------------------------------------

  findUnusedFiles(): UnusedFinding[] {
    const files = this.getScannableFiles();
    const pool = new Set<string>(files.map((sf) => sf.getFilePath() as string));
    const importers = new Map<string, Set<string>>();
    const imports = new Map<string, Set<string>>();

    for (const sf of files) {
      const from = sf.getFilePath() as string;
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
        if (deadFiles.has(fp) || this.isEntryFile(sf)) continue;
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
    const roots = files.filter((sf) => this.isEntryFile(sf));
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

  // ---------------------------------------------------------------------------
  // 4) Unused members (class / interface / enum)
  // ---------------------------------------------------------------------------

  findUnusedMembers(): UnusedFinding[] {
    const findings: UnusedFinding[] = [];
    const files = this.getScannableFiles();
    const publicFiles = this.collectPublicApiFiles(files);
    const dead = this.getUnusedDiagnostics().dead;

    for (const sf of files) {
      if (this.isEntryFile(sf) || publicFiles.has(sf.getFilePath())) continue;

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
          // private đã được TypeScript báo ở findUnusedLocals.
          if (m.hasModifier(SyntaxKind.PrivateKeyword)) continue;
          if (m.getDecorators().length > 0) continue;
          candidates.push({ owner, member: m });
        }
      }

      for (const itf of sf.getDescendantsOfKind(
        SyntaxKind.InterfaceDeclaration,
      )) {
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

        const { external, local } = this.countReferences(
          member,
          references,
          dead,
        );
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

  // ---------------------------------------------------------------------------
  // Run everything
  // ---------------------------------------------------------------------------

  analyze(): UnusedFinding[] {
    const findings: UnusedFinding[] = [];
    let deadFilePaths = new Set<string>();

    if (this.checks.has("files")) {
      const fileFindings = this.findUnusedFiles();
      deadFilePaths = new Set(fileFindings.map((f) => f.filePath));
      findings.push(...fileFindings);
    }
    if (this.checks.has("locals")) findings.push(...this.findUnusedLocals());
    if (this.checks.has("exports")) findings.push(...this.findUnusedExports());
    if (this.checks.has("members")) findings.push(...this.findUnusedMembers());

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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeFinding(
  sf: SourceFile,
  name: string,
  kind: FindingKind,
  start: number,
  end: number,
  message: string,
): UnusedFinding {
  const s = sf.getLineAndColumnAtPos(start);
  const e = sf.getLineAndColumnAtPos(end);
  return {
    filePath: sf.getFilePath(),
    name,
    kind,
    startLine: s.line - 1,
    startChar: s.column - 1,
    endLine: e.line - 1,
    endChar: e.column - 1,
    message,
  };
}

function getNameNodeOf(node: Node): Node | undefined {
  const holder = node as unknown as { getNameNode?: () => Node | undefined };
  return typeof holder.getNameNode === "function"
    ? holder.getNameNode()
    : undefined;
}

function isInRanges(
  ranges: Array<[number, number]> | undefined,
  pos: number,
): boolean {
  if (!ranges) return false;
  return ranges.some(([start, end]) => pos >= start && pos < end);
}

/** Chuyển 1 dòng kiểu .gitignore / glob thành RegExp (khớp theo đường dẫn tương đối dùng "/"). */
function patternToRegExp(raw: string): RegExp | null {
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!"))
    return null;

  const anchored = trimmed.includes("/");
  const p = trimmed.replace(/^\/+/, "");
  let re = "";

  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp((anchored ? "^" : "(?:^|/)") + re + "(?:/.*)?$");
}

function compilePatterns(patterns: string[]): RegExp[] {
  const result: RegExp[] = [];
  for (const raw of patterns) {
    const re = patternToRegExp(raw);
    if (re) result.push(re);
  }
  return result;
}

function readGitignorePatterns(projectRoot: string): string[] {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function normalizePath(p: string): string {
  return path.normalize(p).split(path.sep).join("/");
}
