import type { Painter } from "../tui";

export function renderHelp(paint: Painter): string {
  const cmd = (s: string) => paint.cyan(s);
  return [
    "",
    `  ${paint.bold("ts-reap")} ${paint.dim("— find unused files, exports, imports, variables, parameters and members")}`,
    "",
    `  ${paint.bold("Usage")}`,
    `    ${cmd("ts-reap")} [path]       ${paint.dim("relative or absolute path to a file or folder (defaults to cwd)")}`,
    "",
    `  ${paint.bold("Examples")}`,
    `    ${cmd("ts-reap")}              ${paint.dim("scan the current directory")}`,
    `    ${cmd("ts-reap .")}             ${paint.dim("scan the whole project")}`,
    `    ${cmd("ts-reap src/utils")}     ${paint.dim("scan one folder")}`,
    `    ${cmd("ts-reap /abs/project")}  ${paint.dim("scan any project on disk")}`,
    "",
    `  ${paint.bold("Options")}`,
    `    ${cmd("-h, --help")}            ${paint.dim("show this help")}`,
    `    ${cmd("-v, --version")}         ${paint.dim("show version")}`,
    "",
    `  ${paint.dim("Exit codes: 0 = clean, 1 = findings, 2 = error")}`,
    "",
  ].join("\n");
}
