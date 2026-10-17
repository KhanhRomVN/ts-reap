type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "scan"; target: string }
  | { kind: "error"; message: string };

/** CLI chỉ có 1 lệnh: `ts-reap <path>` (+ `-h`, `-v`). */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "-v" || arg === "--version") return { kind: "version" };
    if (arg.startsWith("-") && arg !== "-") {
      return { kind: "error", message: `Unknown option: ${arg}` };
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) return { kind: "scan", target: "." };
  if (positionals.length > 1) {
    return {
      kind: "error",
      message: `Expected a single path, got ${positionals.length}: ${positionals.join(" ")}`,
    };
  }
  return { kind: "scan", target: positionals[0] };
}
