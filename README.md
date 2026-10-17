# @khanhromvn/ts-reap

An advanced TypeScript/JavaScript static analysis tool that detects **project-wide unused exports, functions, and variables** — filling the gap left by vanilla `tsserver`.

Standard LSP diagnostics (`noUnusedLocals`, `noUnusedParameters`) only analyze code within a single file scope. `ts-reap` builds a whole-project reference graph using [ts-morph](https://ts-morph.com) to identify dead code that is exported but never imported or used elsewhere in the project.

## Features

- **Whole-Project Analysis**: Detects unused exports across module boundaries.
- **Simple CLI Interface**: Just run `ts-reap <path>` to scan your project.
- **Smart Filtering**: Ignores re-exports (`export * from './mod'`) as false positives; only counts actual usage.
- **Configurable Entry Points**: Define which files are allowed to have "unused" exports (e.g., library entry points).
- **JSON Output**: Easy integration with CI/CD pipelines and other tools.

## Installation

### Global Install (Recommended for CLI)

```bash
npm install -g @khanhromvn/ts-reap
```

### Project Dev Dependency

```bash
npm install --save-dev @khanhromvn/ts-reap
```

## Usage

### Basic Scan

Scan the current directory (or specified path) for unused declarations:

```bash
# Scan current directory
ts-reap

# Scan specific folder/file
ts-reap ./src/lib
ts-reap src/index.ts
```

### Advanced Options

```bash
# JSON output for parsing
ts-reap --format json

# Specify custom tsconfig
ts-reap --tsconfig ./configs/tsconfig.build.json

# Define entry files (their exports won't be flagged as unused)
ts-reap --entry src/index.ts,src/main.ts

# Ignore specific patterns
ts-reap --ignore "**/*.test.ts,**/generated/**"

# Don't exit with error code even if findings exist
ts-reap --no-exit-code
```

### Exit Codes

- `0`: Clean (no unused items found) or `--no-exit-code` was passed.
- `1`: Findings detected (default behavior when unused items are found).
- `2`: Error (invalid arguments, missing tsconfig, etc.).

## How It Works

1. **Initialization**: The tool locates `tsconfig.json` (from argument or nearest parent) and creates a `ts-morph` Project instance.
2. **Reference Graph**: It iterates through every non-ignored file's exported declarations.
3. **Usage Detection**: For each export, it searches the entire project for references using `findReferencesAsNodes()`.
4. **Filtering**: Re-exports (barrel files) are excluded from counting as "usage" to prevent false negatives. Only direct imports and local usages count.
5. **Reporting**: Results are printed to stdout in text or JSON format.

## Programmatic API

You can also import the analyzer directly into your Node.js scripts:

```typescript
import { ProjectAnalyzer } from '@khanhromvn/ts-reap';

const analyzer = new ProjectAnalyzer({
  tsConfigFilePath: './tsconfig.json',
  entryPatterns: ['src/index.ts'], 
  ignorePatterns: ['**/*.test.ts']
});

const findings = analyzer.analyze();

if (findings.length > 0) {
  console.log(`Found ${findings.length} unused exports:`);
  findings.forEach(f => {
    console.log(`${f.kind}: ${f.name} in ${f.filePath}:${f.startLine + 1}`);
  });
}
```

## Roadmap

- [x] Core Analyzer (whole-project unused detection)
- [x] Simplified CLI (`ts-reap <path>`)
- [ ] Incremental analysis for large monorepos (performance optimization)
- [ ] Support for type-only exports vs value exports distinction
- [ ] Quick-fix actions (auto-remove unused exports)
- [ ] Config file support (`.ts-reaprc.json`)

## Why not just use Knip?

[Knip](https://knip.dev) is an excellent tool for detecting unused files, dependencies, and exports. However, `ts-reap` focuses specifically on being a lightweight, zero-config solution for **export-level** dead code detection with minimal overhead. If you need comprehensive project hygiene (unused deps, unlisted files), Knip is recommended. If you want fast, inline feedback for unused exports in your editor or a simple CI gate, `ts-reap` is designed for that precision.

## License

MIT