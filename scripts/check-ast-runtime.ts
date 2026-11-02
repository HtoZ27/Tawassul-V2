import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULES = [
  "src/services/ast-service.ts",
  "src/utils/logger.ts",
  "src/utils/state-paths.ts",
  "src/utils/path-resolver.ts",
];

const WASM_ASSETS = [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
  "tree-sitter-typescript/tree-sitter-tsx.wasm",
  "tree-sitter-javascript/tree-sitter-javascript.wasm",
];

interface Structure {
  symbols: Array<{ name: string; kind: string }>;
  imports: Array<{ source: string }>;
}

interface Service {
  init(): Promise<void>;
  getParser(language: string): Promise<unknown>;
  getStructure(file: string, content?: string): Promise<Structure | null>;
}

function fail(message: string): never {
  console.error(`ast: FAIL ${message}`);
  process.exit(1);
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(flagValue("--repo") ?? join(here, ".."));
const runtime = resolve(flagValue("--runtime") ?? join(repo, "tawassul-runtime"));
const wasmRoot = join(runtime, "wasm");

for (const asset of WASM_ASSETS) {
  const file = join(wasmRoot, asset);
  if (!existsSync(file)) fail(`missing wasm asset ${file}`);
  if (statSync(file).size === 0) fail(`empty wasm asset ${file}`);
}
console.log(`ast: runtime=${runtime}`);

const work = mkdtempSync(join(tmpdir(), "tawassul-ast-"));
try {
  for (const module of MODULES) {
    const target = join(work, module);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repo, module), target);
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"), linkType);
  symlinkSync(runtime, join(work, "src", "services", "tawassul-runtime"), linkType);

  const tsFile = join(work, "sample.ts");
  writeFileSync(
    tsFile,
    [
      'import { readFile } from "node:fs";',
      "export interface Shape { area(): number }",
      "export class Square implements Shape {",
      "  constructor(private side: number) {}",
      "  area() { return this.side * this.side; }",
      "}",
      "export function total(shapes: Shape[]): number {",
      "  return shapes.reduce((sum, shape) => sum + shape.area(), 0);",
      "}",
      "",
    ].join("\n"),
  );

  const tsxFile = join(work, "sample.tsx");
  writeFileSync(tsxFile, ['export const Badge = () => <span className="badge">ok</span>;', ""].join("\n"));

  const jsFile = join(work, "sample.js");
  writeFileSync(jsFile, ["export function double(value) {", "  return value * 2;", "}", ""].join("\n"));

  const astModule = (await import(pathToFileURL(join(work, "src", "services", "ast-service.ts")).href)) as {
    getAstService(): Service;
  };
  const service = astModule.getAstService();
  await service.init();

  for (const language of ["typescript", "tsx", "javascript"]) {
    const parser = await service.getParser(language);
    if (parser === null || parser === undefined) fail(`the parser for ${language} did not load from ${wasmRoot}`);
  }

  const structure = await service.getStructure(tsFile);
  if (!structure) fail("the TypeScript structure was null");
  const names = structure.symbols.map((symbol) => symbol.name);
  for (const expected of ["Shape", "Square", "total"]) {
    if (!names.includes(expected)) fail(`the TypeScript structure is missing ${expected}; saw ${names.join(", ")}`);
  }
  const importSources = structure.imports.map((entry) => entry.source);
  if (!importSources.includes("node:fs")) fail(`the TypeScript imports are missing node:fs; saw ${importSources.join(", ")}`);

  const tsxStructure = await service.getStructure(tsxFile);
  if (!tsxStructure) fail("the TSX structure was null");
  if (!tsxStructure.symbols.some((symbol) => symbol.name === "Badge")) fail("the TSX structure is missing Badge");

  const jsStructure = await service.getStructure(jsFile);
  if (!jsStructure) fail("the JavaScript structure was null");
  if (!jsStructure.symbols.some((symbol) => symbol.name === "double")) fail("the JavaScript structure is missing double");

  console.log(`ast: PASS typescript=${names.length} tsx=${tsxStructure.symbols.length} javascript=${jsStructure.symbols.length}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
