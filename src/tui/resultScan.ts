import * as path from "path";
import type { FindingKind, UnusedFinding } from "../core/types";
import { fit, type Painter } from "./ansi";
import { KIND_LABEL_WIDTH, KIND_META, KIND_ORDER } from "./theme";

interface ScanResult {
  findings: UnusedFinding[];
  root: string;
  scannedFiles: number;
  elapsedMs: number;
}

const INDENT = "  ";
const SUMMARY_BAR_WIDTH = 16;
const MAX_NAME_WIDTH = 28;

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function groupByFile(
  findings: UnusedFinding[],
  root: string,
): Map<string, UnusedFinding[]> {
  const grouped = new Map<string, UnusedFinding[]>();
  for (const f of findings) {
    const rel = path.relative(root, f.filePath).split(path.sep).join("/");
    const list = grouped.get(rel) ?? [];
    list.push(f);
    grouped.set(rel, list);
  }
  return grouped;
}

function renderBadge(paint: Painter, kind: FindingKind): string {
  const meta = KIND_META[kind];
  return paint.color(meta.color, `● ${meta.label.padEnd(KIND_LABEL_WIDTH)}`);
}

function renderClean(paint: Painter, r: ScanResult): string {
  return [
    "",
    `${INDENT}${paint.green("✔")} ${paint.bold("All clean")} ${paint.dim(
      `— no unused code in ${plural(r.scannedFiles, "file")} · ${formatElapsed(r.elapsedMs)}`,
    )}`,
    "",
  ].join("\n");
}

function renderSummary(paint: Painter, findings: UnusedFinding[]): string[] {
  const counts = new Map<FindingKind, number>();
  for (const f of findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const max = Math.max(...counts.values());

  const lines: string[] = [];
  for (const kind of KIND_ORDER) {
    const n = counts.get(kind);
    if (!n) continue;
    const filled = Math.max(1, Math.round((n / max) * SUMMARY_BAR_WIDTH));
    let bar = "";
    for (let i = 0; i < SUMMARY_BAR_WIDTH; i++) {
      bar +=
        i < filled
          ? paint.color(KIND_META[kind].color, "█")
          : paint.dim("░");
    }
    lines.push(
      `${INDENT}${renderBadge(paint, kind)} ${bar} ${paint.bold(String(n))}`,
    );
  }
  return lines;
}

export function renderResultScan(
  paint: Painter,
  r: ScanResult,
  width: number,
): string {
  if (r.findings.length === 0) return renderClean(paint, r);

  const grouped = groupByFile(r.findings, r.root);
  const out: string[] = [""];

  out.push(
    `${INDENT}${paint.red("✖")} ${paint.bold(
      plural(r.findings.length, "unused item"),
    )} ${paint.dim(`in ${plural(grouped.size, "file")}`)}`,
  );

  for (const [rel, items] of grouped) {
    const abs = path.join(r.root, rel);
    out.push("");
    out.push(
      `${INDENT}${paint.link(paint.cyan(paint.bold(rel)), abs)} ${paint.dim(`(${items.length})`)}`,
    );

    const nameWidth = Math.min(
      MAX_NAME_WIDTH,
      Math.max(...items.map((i) => i.name.length)),
    );

    for (const f of items) {
      const line = f.startLine + 1;
      const loc = `${line}:${f.startChar + 1}`.padEnd(7);
      const name = fit(f.name, nameWidth).padEnd(nameWidth);
      // INDENT*2 + loc + badge(2+label) + name + khoảng cách
      const fixed = INDENT.length * 2 + 7 + 2 + KIND_LABEL_WIDTH + 1 + nameWidth + 4;
      const msg = fit(f.message, Math.max(0, width - fixed));

      out.push(
        `${INDENT}${INDENT}${paint.dim(paint.link(loc, abs, line))}${renderBadge(
          paint,
          f.kind,
        )} ${paint.color(223, name)}  ${paint.dim(msg)}`,
      );
    }
  }

  out.push("");
  out.push(`${INDENT}${paint.dim("─".repeat(Math.min(width - 4, 48)))}`);
  out.push(...renderSummary(paint, r.findings));
  out.push("");
  out.push(
    `${INDENT}${paint.dim(
      `scanned ${plural(r.scannedFiles, "file")} in ${formatElapsed(r.elapsedMs)}`,
    )}`,
  );
  out.push("");

  return out.join("\n");
}
