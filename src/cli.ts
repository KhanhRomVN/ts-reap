#!/usr/bin/env node
/**
 * CLI tool cho ts-reap
 * Usage: ts-reap check [paths...] [options]
 */
import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";
import {
  ProjectAnalyzer,
  UnusedFinding,
  CheckKind,
  ALL_CHECKS,
} from "./analyzer";

interface CliOptions {
  tsconfig?: string;
  entryPatterns?: string[];
  ignorePatterns?: string[];
  scopePaths?: string[];
  checks?: CheckKind[];
  format?: "text" | "json";
  exitCode?: boolean;
}

const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function colorize(text: string, code: string): string {
  return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function link(text: string, filePath: string, line?: number): string {
  if (!USE_COLOR) return text;
  const uri =
    pathToFileURL(filePath).href + (line !== undefined ? `#L${line}` : "");
  return `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    console.error(`Missing value for ${flag}`);
    process.exit(2);
  }
  return value as string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    format: "text",
    exitCode: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--tsconfig":
        options.tsconfig = readValue(args, ++i, arg);
        break;
      case "--entry":
        options.entryPatterns = splitList(readValue(args, ++i, arg));
        break;
      case "--ignore":
        options.ignorePatterns = splitList(readValue(args, ++i, arg));
        break;
      case "--scope":
        options.scopePaths = [
          ...(options.scopePaths ?? []),
          ...splitList(readValue(args, ++i, arg)),
        ];
        break;
      case "--checks": {
        const list = splitList(readValue(args, ++i, arg));
        const invalid = list.filter(
          (c) => !ALL_CHECKS.includes(c as CheckKind),
        );
        if (invalid.length > 0) {
          console.error(
            `Unknown check(s): ${invalid.join(", ")}. Valid: ${ALL_CHECKS.join(", ")}`,
          );
          process.exit(2);
        }
        options.checks = list as CheckKind[];
        break;
      }
      case "--format": {
        const value = readValue(args, ++i, arg);
        if (value !== "text" && value !== "json") {
          console.error(`Invalid --format "${value}". Use "text" or "json".`);
          process.exit(2);
        }
        options.format = value as "text" | "json";
        break;
      }
      case "--no-exit-code":
        options.exitCode = false;
        break;
      case "--help":
      case "-h":
        showHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(2);
        }
        options.scopePaths = [...(options.scopePaths ?? []), arg];
    }
  }

  return options;
}

function showHelp() {
  console.log(`ts-reap - find unused files, exports, imports, variables, parameters and members.

Usage:
  ts-reap check [paths...] [options]

Arguments:
  paths                  Files/folders to scan (default: everything in tsconfig.json, or cwd)

Options:
  --tsconfig <file>      Path to tsconfig.json (default: nearest tsconfig.json upwards from cwd)
  --scope <a,b>          Same as positional paths, comma separated
  --entry <a,b>          Entry patterns (REPLACES defaults). Entry files are never reported as
                         unused files and their exports are treated as public API
  --ignore <a,b>         Ignore patterns (REPLACES defaults; .gitignore is always added)
  --checks <a,b>         Subset of: ${ALL_CHECKS.join(", ")} (default: all)
  --format <text|json>   Output format (default: text)
  --no-exit-code         Always exit with 0 even when findings exist
  -h, --help             Show this help

Exit codes: 0 = clean, 1 = findings, 2 = error`);
}

function findTsConfig(startDir: string): string | null {
  let currentDir = startDir;

  while (true) {
    const tsconfigPath = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function formatTextOutput(
  findings: UnusedFinding[],
  projectRoot: string,
): string {
  if (findings.length === 0) {
    return colorize("No unused declarations found!", "32");
  }

  const grouped = new Map<string, UnusedFinding[]>();
  const kindCount = new Map<string, number>();

  for (const finding of findings) {
    const relativePath = path.relative(projectRoot, finding.filePath);
    if (!grouped.has(relativePath)) {
      grouped.set(relativePath, []);
    }
    grouped.get(relativePath)!.push(finding);
    kindCount.set(finding.kind, (kindCount.get(finding.kind) ?? 0) + 1);
  }

  let output =
    colorize(
      `Found ${findings.length} unused item(s) in ${grouped.size} file(s):`,
      "31",
    ) + "\n\n";

  for (const [filePath, fileFindings] of grouped) {
    const absPath = path.join(projectRoot, filePath);
    output += link(colorize(filePath, "36"), absPath) + "\n";
    for (const finding of fileFindings) {
      const line = finding.startLine + 1;
      const nameDisplay = link(colorize(finding.name, "33"), absPath, line);
      output += `  L${line}: ${nameDisplay} (${finding.kind})\n`;
      output += `  ${colorize(finding.message, "90")}\n\n`;
    }
  }

  const summary = Array.from(kindCount.entries())
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ");
  output += colorize(`Summary: ${summary}`, "90");

  return output;
}

function formatJsonOutput(findings: UnusedFinding[]): string {
  const byKind: Record<string, number> = {};
  for (const f of findings) {
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  }

  return JSON.stringify(
    {
      totalUnused: findings.length,
      byKind,
      findings: findings.map((f) => ({
        file: f.filePath,
        name: f.name,
        kind: f.kind,
        line: f.startLine + 1,
        column: f.startChar + 1,
        message: f.message,
      })),
    },
    null,
    2,
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    process.exit(0);
  }

  if (args[0] !== "check") {
    console.error(`Unknown command: ${args[0]}`);
    console.error('Run "ts-reap --help" for usage');
    process.exit(2);
  }

  const options = parseArgs(args.slice(1));

  let tsconfigPath: string | null = null;
  if (options.tsconfig) {
    tsconfigPath = path.resolve(process.cwd(), options.tsconfig);
    if (!fs.existsSync(tsconfigPath)) {
      console.error(`tsconfig.json not found at: ${tsconfigPath}`);
      process.exit(2);
    }
  } else {
    tsconfigPath = findTsConfig(process.cwd());
    if (!tsconfigPath) {
      console.error("No tsconfig.json found - using default compiler options.");
    }
  }

  const projectRoot = tsconfigPath ? path.dirname(tsconfigPath) : process.cwd();

  const scopePaths = options.scopePaths?.map((p) =>
    path.resolve(process.cwd(), p),
  );
  for (const p of scopePaths ?? []) {
    if (!fs.existsSync(p)) {
      console.error(`Scope path not found: ${p}`);
      process.exit(2);
    }
  }

  try {
    const analyzer = new ProjectAnalyzer({
      tsConfigFilePath: tsconfigPath ?? undefined,
      rootDir: process.cwd(),
      entryPatterns: options.entryPatterns,
      ignorePatterns: options.ignorePatterns,
      scopePaths,
      checks: options.checks,
    });

    const findings = analyzer.analyze();

    if (options.format === "json") {
      console.log(formatJsonOutput(findings));
    } else {
      console.log(formatTextOutput(findings, projectRoot));
    }

    process.exitCode = findings.length > 0 && options.exitCode ? 1 : 0;
  } catch (error) {
    console.error("Error during analysis:", error);
    process.exitCode = 2;
  }
}

main();
