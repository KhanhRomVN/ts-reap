import type { Node, SourceFile } from "ts-morph";
import type { FindingKind, UnusedFinding } from "../types";

export function makeFinding(
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

export function getNameNodeOf(node: Node): Node | undefined {
  const holder = node as unknown as { getNameNode?: () => Node | undefined };
  return typeof holder.getNameNode === "function"
    ? holder.getNameNode()
    : undefined;
}

export function isInRanges(
  ranges: Array<[number, number]> | undefined,
  pos: number,
): boolean {
  if (!ranges) return false;
  return ranges.some(([start, end]) => pos >= start && pos < end);
}
