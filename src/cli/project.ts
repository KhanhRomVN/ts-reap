import * as path from "path";
import * as fs from "fs";

interface ResolvedTarget {
  /** Đường dẫn tuyệt đối của file/folder cần quét. */
  targetAbs: string;
  /** Thư mục gốc project (nơi chứa tsconfig.json, hoặc chính thư mục quét). */
  root: string;
  tsconfigPath?: string;
  /** undefined = quét toàn bộ project theo tsconfig; ngược lại chỉ quét các path này. */
  scopePaths?: string[];
}

function findTsConfig(startDir: string): string | undefined {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return undefined;
    currentDir = parentDir;
  }
}

/** Phân giải `<relative-path|system-path>` thành target + project root + scope. */
export function resolveTarget(input: string, cwd: string): ResolvedTarget | null {
  const targetAbs = path.resolve(cwd, input);
  if (!fs.existsSync(targetAbs)) return null;

  const startDir = fs.statSync(targetAbs).isDirectory()
    ? targetAbs
    : path.dirname(targetAbs);

  const tsconfigPath = findTsConfig(startDir);
  const root = tsconfigPath ? path.dirname(tsconfigPath) : startDir;

  // Quét đúng thư mục gốc project => dùng danh sách file của tsconfig.
  const scopePaths = path.resolve(root) === targetAbs ? undefined : [targetAbs];

  return { targetAbs, root, tsconfigPath, scopePaths };
}
