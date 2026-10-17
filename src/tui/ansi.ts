import { pathToFileURL } from "url";

/** Dải màu 256 chuyển từ cyan sang magenta, dùng cho banner và progress bar. */
const GRADIENT = [51, 45, 39, 33, 63, 99, 135, 171, 207];

export interface Painter {
  readonly enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
  /** Màu 256. */
  color(code: number, s: string): string;
  /** Hyperlink OSC 8 tới file (+ dòng). */
  link(text: string, filePath: string, line?: number): string;
}

export function supportsColor(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return process.env.FORCE_COLOR !== "0";
  return Boolean(stream.isTTY) && process.env.TERM !== "dumb";
}

export function createPainter(enabled: boolean): Painter {
  const wrap = (open: string, close: string) => (s: string) =>
    enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

  const bold = wrap("1", "22");
  const dim = wrap("2", "22");
  const red = wrap("31", "39");
  const green = wrap("32", "39");
  const cyan = wrap("36", "39");
  const gray = wrap("90", "39");

  return {
    enabled,
    bold,
    dim,
    red,
    green,
    cyan,
    gray,
    color: (code, s) => (enabled ? `\x1b[38;5;${code}m${s}\x1b[39m` : s),
    link: (text, filePath, line) => {
      if (!enabled) return text;
      const uri =
        pathToFileURL(filePath).href + (line !== undefined ? `#L${line}` : "");
      return `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;
    },
  };
}

/** Màu gradient theo vị trí 0..1. */
export function gradientAt(t: number): number {
  const i = Math.min(
    GRADIENT.length - 1,
    Math.max(0, Math.round(t * (GRADIENT.length - 1))),
  );
  return GRADIENT[i];
}

/** Cắt chuỗi thuần (không chứa ANSI) cho vừa độ rộng, thêm "…" khi bị cắt. */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  return width === 1 ? "…" : text.slice(0, width - 1) + "…";
}

export function terminalWidth(stream: NodeJS.WriteStream): number {
  return Math.max(40, stream.columns ?? 80);
}
