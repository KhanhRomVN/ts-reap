import * as path from "path";

export function normalizePath(p: string): string {
  return path.normalize(p).split(path.sep).join("/");
}
