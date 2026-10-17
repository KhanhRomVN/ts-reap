#!/usr/bin/env node
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";
import { ProjectAnalyzer } from "../core/analyzer";
import type { UnusedFinding } from "../core/types";
import { toDiagnostic } from "./diagnostics";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let analyzer: ProjectAnalyzer | undefined;
let debounceTimer: NodeJS.Timeout | undefined;
const DEBOUNCE_MS = 1000;

function findTsConfig(rootPath: string): string | undefined {
  const candidate = path.join(rootPath, "tsconfig.json");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace("file://", "");
  }
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const rootPath = params.rootUri
    ? uriToPath(params.rootUri)
    : (params.rootPath ?? process.cwd());

  const tsConfigFilePath = findTsConfig(rootPath);
  const initOptions = params.initializationOptions as
    | {
        entryPatterns?: string[];
        ignorePatterns?: string[];
      }
    | undefined;

  if (tsConfigFilePath) {
    analyzer = new ProjectAnalyzer({
      tsConfigFilePath,
      entryPatterns: initOptions?.entryPatterns ?? [
        "src/index.ts",
        "src/main.ts",
      ],
      ignorePatterns: initOptions?.ignorePatterns,
    });
  } else {
    connection.console.warn(
      "ts-reap: no tsconfig.json found at project root; analyzer not started.",
    );
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
    },
  };
});

function scheduleAnalysis() {
  if (!analyzer) return;
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(runAnalysisAndPublish, DEBOUNCE_MS);
}

function runAnalysisAndPublish() {
  if (!analyzer) return;

  try {
    analyzer.refresh();
    const allFindings = analyzer.analyze();

    // Group findings by file so we only send diagnostics for currently open docs
    // (avoids spamming the client with data for files it hasn't opened yet).
    const byFile = new Map<string, UnusedFinding[]>();
    for (const finding of allFindings) {
      const list = byFile.get(finding.filePath) ?? [];
      list.push(finding);
      byFile.set(finding.filePath, list);
    }

    for (const doc of documents.all()) {
      const findings = byFile.get(uriToPath(doc.uri)) ?? [];
      connection.sendDiagnostics({
        uri: doc.uri,
        diagnostics: findings.map(toDiagnostic),
      });
    }
  } catch (err) {
    connection.console.error(`ts-reap analysis failed: ${String(err)}`);
  }
}

documents.onDidOpen((event) => {
  analyzer?.updateFile(uriToPath(event.document.uri), event.document.getText());
  scheduleAnalysis();
});

documents.onDidChangeContent((event) => {
  analyzer?.updateFile(uriToPath(event.document.uri), event.document.getText());
  scheduleAnalysis();
});

documents.onDidSave(() => {
  scheduleAnalysis();
});

documents.listen(connection);
connection.listen();
