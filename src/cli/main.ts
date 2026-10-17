#!/usr/bin/env node
/**
 * CLI ts-reap — một lệnh duy nhất:
 *   ts-reap <relative-path|system-path>
 */
import * as path from "path";
import * as fs from "fs";
import { ProjectAnalyzer } from "../core/analyzer";
import {
  LoadingProgress,
  createPainter,
  renderResultScan,
  renderWelcomeBanner,
  supportsColor,
  terminalWidth,
} from "../tui";
import { parseArgs } from "./args";
import { renderHelp } from "./help";
import { resolveTarget } from "./project";

function readVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function main(): number {
  const out = process.stdout;
  const err = process.stderr;
  const outPaint = createPainter(supportsColor(out));
  const errPaint = createPainter(supportsColor(err));

  const args = parseArgs(process.argv.slice(2));

  switch (args.kind) {
    case "help":
      out.write(renderHelp(outPaint));
      return 0;
    case "version":
      out.write(readVersion() + "\n");
      return 0;
    case "error":
      err.write(`${errPaint.red("✖")} ${args.message}\n`);
      err.write(errPaint.dim('  Run "ts-reap --help" for usage.\n'));
      return 2;
    case "scan":
      break;
  }

  const cwd = process.cwd();
  const resolved = resolveTarget(args.target, cwd);
  if (!resolved) {
    err.write(`${errPaint.red("✖")} Path not found: ${path.resolve(cwd, args.target)}\n`);
    return 2;
  }

  // Hiển thị path tương đối nếu nằm trong cwd, ngược lại dùng path tuyệt đối cho gọn.
  const rootRel = (p: string) => {
    const rel = path.relative(cwd, p) || ".";
    return rel.startsWith("..") ? p : rel;
  };

  err.write(
    renderWelcomeBanner(errPaint, {
      version: readVersion(),
      target: rootRel(resolved.targetAbs),
      root: resolved.root,
      tsconfig: resolved.tsconfigPath ? rootRel(resolved.tsconfigPath) : undefined,
    }) + "\n",
  );

  const progress = new LoadingProgress(err, errPaint);
  const started = Date.now();

  try {
    progress.start("Loading project…");
    const analyzer = new ProjectAnalyzer({
      tsConfigFilePath: resolved.tsconfigPath,
      rootDir: resolved.root,
      scopePaths: resolved.scopePaths,
      onProgress: (e) => progress.update(e),
    });

    const findings = analyzer.analyze();
    progress.stop();

    out.write(
      renderResultScan(
        outPaint,
        {
          findings,
          root: resolved.root,
          scannedFiles: analyzer.getScannedFileCount(),
          elapsedMs: Date.now() - started,
        },
        terminalWidth(out),
      ),
    );
    return findings.length > 0 ? 1 : 0;
  } catch (error) {
    progress.stop();
    err.write(`${errPaint.red("✖")} Analysis failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main();
