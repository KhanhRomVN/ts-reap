import * as path from "path";
import * as fs from "fs";

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

export function compilePatterns(patterns: string[]): RegExp[] {
  const result: RegExp[] = [];
  for (const raw of patterns) {
    const re = patternToRegExp(raw);
    if (re) result.push(re);
  }
  return result;
}

export function readGitignorePatterns(projectRoot: string): string[] {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
