import type { CheckKind, FindingKind } from "../core/types";

interface KindMeta {
  label: string;
  /** Màu 256. */
  color: number;
}

export const KIND_META: Record<FindingKind, KindMeta> = {
  file: { label: "file", color: 203 },
  export: { label: "export", color: 214 },
  import: { label: "import", color: 221 },
  local: { label: "local", color: 114 },
  parameter: { label: "param", color: 80 },
  member: { label: "member", color: 177 },
  unreachable: { label: "dead-code", color: 245 },
};

export const KIND_ORDER: FindingKind[] = [
  "file",
  "export",
  "import",
  "local",
  "parameter",
  "member",
  "unreachable",
];

export const STAGE_LABEL: Record<CheckKind, string> = {
  files: "Tracing import graph",
  locals: "Type-checking",
  exports: "Resolving exports",
  members: "Resolving members",
};

export const KIND_LABEL_WIDTH = 9;
