import { build } from "bun";
import { rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outdir = "./dist";
rmSync(outdir, { recursive: true, force: true });

const staleFiles = existsSync(outdir) ? readdirSync(outdir) : [];
for (const f of staleFiles) {
  if (f.endsWith(".tmp")) rmSync(join(outdir, f), { force: true });
}

function resolvesModule(id) {
  try {
    import.meta.resolve(id);
    return true;
  } catch {
    return false;
  }
}

const explicitExternal = ["@opencode/plugin"];
const transitiveExternal = ["@opencode/ai", "@opencode/client", "@opencode/protocol", "@opencode/schema", "@opencode/util", "effect", "zod"];
const external = resolvesModule("@opencode/plugin") ? [...explicitExternal, ...transitiveExternal] : [];

console.log(`resolve guard: @opencode/plugin ${external.length > 0 ? "external" : "bundled"}`);

const result = await build({
  outdir,
  target: "node",
  format: "esm",
  sourcemap: "none",
  external,
  splitting: false,
  entrypoints: ["./src/index.ts"],
  naming: { entry: "index.js" },
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

const dtsTarget = join(outdir, "index.d.ts");
if (existsSync(dtsTarget)) {
  const content = readFileSync(dtsTarget, "utf8");
  const fixed = content.replace(/from\s+["']([^"']+)\.ts["']/g, (match, path) => {
    return match.replace(".ts\"", ".js\"");
  });
  if (fixed !== content) writeFileSync(dtsTarget, fixed, "utf8");
}

console.log(`Build complete: ${join(outdir, "index.js")}`);

const pluginDir = join(".opencode", "plugin");
mkdirSync(pluginDir, { recursive: true });
copyFileSync(join(outdir, "index.js"), join(pluginDir, "tawassul.js"));
console.log(`Plugin entry ready: ${join(pluginDir, "tawassul.js")} (run bun install --cwd .opencode once)`);