export type FindingKind =
  | "file"
  | "export"
  | "import"
  | "local"
  | "parameter"
  | "member"
  | "unreachable";

export type CheckKind = "files" | "exports" | "locals" | "members";

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

/** Khoảng [start, end) trong file đã bị coi là "chết" (vd: import không dùng). */
export type DeadRanges = Map<string, Array<[number, number]>>;

export interface DiagnosticsResult {
  findings: UnusedFinding[];
  dead: DeadRanges;
}

export interface ProgressEvent {
  /** Giai đoạn đang chạy. */
  stage: CheckKind;
  /** Thứ tự (0-based) của giai đoạn trong số các giai đoạn thực sự chạy. */
  stageIndex: number;
  stageCount: number;
  current: number;
  total: number;
  /** File đang xử lý (đường dẫn tương đối). */
  file?: string;
}

export type ProgressListener = (event: ProgressEvent) => void;

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
  /** Callback nhận tiến trình phân tích (dùng cho TUI). */
  onProgress?: ProgressListener;
}
