# @khanhromvn/ts-reap

An advanced TypeScript/JavaScript language server and CLI tool that detects **project-wide unused exports, functions, and variables** — filling the gap left by vanilla `tsserver`.

Standard LSP diagnostics (`noUnusedLocals`, `noUnusedParameters`) only analyze code within a single file scope. `ts-reap` builds a whole-project reference graph using [ts-morph](https://ts-morph.com) to identify dead code that is exported but never imported or used elsewhere in the project.

## Features

- **Whole-Project Analysis**: Detects unused exports across module boundaries.
- **LSP Native**: Integrates seamlessly with VS Code, Neovim, Helix, and any LSP-compatible editor for real-time squiggles.
- **CLI for CI/CD**: Run checks independently of an editor for pre-commit hooks or GitHub Actions.
- **Smart Filtering**: Ignores re-exports (`export * from './mod'`) as false positives; only counts actual usage.
- **Configurable Entry Points**: Define which files are allowed to have "unused" exports (e.g., library entry points).

## Installation

### Global Install (Recommended for CLI/LSP)

```bash
npm install -g @khanhromvn/ts-reap
```

### Project Dev Dependency

```bash
npm install --save-dev @khanhromvn/ts-reap
```

## Usage

### 1. Language Server Mode (Editor Integration)

To use `ts-reap` as an LSP server in your editor:

```bash
# Start the server via stdio (standard for LSP clients)
ts-reap --stdio
```

#### VS Code Configuration Example

Add this to your `.vscode/settings.json`:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "ts-reap.serverPath": "ts-reap",
  "ts-reap.args": ["--stdio"]
}
```

*Note: For full VS Code integration with UI controls, consider installing the companion extension if available, or configure your generic LSP client.*

### 2. CLI Check Mode (CI & Pre-commit)

Use the `ts-reap-check` binary to scan your project and report unused exports without starting a server. This is ideal for Continuous Integration pipelines.

```bash
# Basic check
npx ts-reap-check

# Check specific paths
npx ts-reap-check src/lib

# JSON output for parsing
npx ts-reap-check --format json

# Exit with error code 1 if issues found (for CI gates)
npx ts-reap-check --exit-code
```

### 3. Programmatic API

You can also import the analyzer directly into your Node.js scripts:

```typescript
import { ProjectAnalyzer } from '@khanhromvn/ts-reap';

const analyzer = new ProjectAnalyzer({
  tsConfigFilePath: './tsconfig.json',
  entryPatterns: ['src/index.ts', 'src/main.ts'], // Files allowed to have unused exports
  ignorePatterns: ['**/*.test.ts', '**/generated/**']
});

const findings = analyzer.analyze();

if (findings.length > 0) {
  console.log(`Found ${findings.length} unused exports:`);
  findings.forEach(f => {
    console.log(`${f.kind}: ${f.name} in ${f.filePath}:${f.line}`);
  });
}
```

## How It Works

1. **Initialization**: The server/CLI locates `tsconfig.json` and creates a `ts-morph` Project instance, loading all source files defined in the compilation unit.
2. **Reference Graph**: It iterates through every non-ignored file's exported declarations.
3. **Usage Detection**: For each export, it searches the entire project for references using `findReferencesAsNodes()`.
4. **Filtering**: Re-exports (barrel files) are excluded from counting as "usage" to prevent false negatives. Only direct imports and local usages count.
5. **Reporting**: 
   - In **LSP mode**, diagnostics are published per open document.
   - In **CLI mode**, results are printed to stdout (text or JSON).

## Roadmap

- [x] Core Analyzer (whole-project unused detection)
- [x] LSP Server Implementation
- [x] CLI Tool (`ts-reap-check`)
- [ ] Incremental analysis for large monorepos (performance optimization)
- [ ] Support for type-only exports vs value exports distinction
- [ ] Quick-fix actions (auto-remove unused exports)
- [ ] Config file support (`.ts-reaprc.json`)

## Why not just use Knip?

[Knip](https://knip.dev) is an excellent tool for detecting unused files, dependencies, and exports. However, `ts-reap` focuses specifically on being a lightweight, LSP-native solution for **export-level** dead code detection with minimal configuration overhead. If you need comprehensive project hygiene (unused deps, unlisted files), Knip is recommended. If you want fast, inline feedback for unused exports in your editor or a simple CI gate, `ts-reap` is designed for that precision.

## License

MIT