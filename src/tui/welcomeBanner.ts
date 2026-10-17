import { gradientAt, type Painter } from "./ansi";

// Font block 2 dòng cho chữ "ts-reap".
const GLYPHS: Record<string, [string, string]> = {
  t: ["▀█▀", " █ "],
  s: ["█▀", "▄█"],
  "-": ["▄▄", "  "],
  r: ["█▀█", "█▀▄"],
  e: ["█▀▀", "██▄"],
  a: ["▄▀█", "█▀█"],
  p: ["█▀█", "█▀▀"],
};

function buildArt(text: string): [string, string] {
  const rows: [string[], string[]] = [[], []];
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) continue;
    rows[0].push(g[0]);
    rows[1].push(g[1]);
  }
  return [rows[0].join(" "), rows[1].join(" ")];
}

interface BannerInfo {
  version: string;
  /** Đường dẫn đang quét (hiển thị cho người dùng). */
  target: string;
  /** Thư mục gốc project. */
  root: string;
  tsconfig?: string;
}

export function renderWelcomeBanner(paint: Painter, info: BannerInfo): string {
  const art = buildArt("ts-reap");
  const width = art[0].length;

  const lines = art.map((row) => {
    let out = "";
    for (let i = 0; i < row.length; i++) {
      out += row[i] === " " ? " " : paint.color(gradientAt(i / width), row[i]);
    }
    return "  " + out;
  });

  const tagline = `${paint.dim("find dead code in TypeScript")}  ${paint.gray("v" + info.version)}`;
  const meta = [
    `${paint.cyan("◆")} ${paint.gray("target ")} ${info.target}`,
    `${paint.cyan("◆")} ${paint.gray("project")} ${info.tsconfig ?? paint.dim("(no tsconfig — default options)")}`,
  ];

  return [
    "",
    ...lines,
    "  " + tagline,
    "",
    ...meta.map((m) => "  " + m),
    "",
  ].join("\n");
}
