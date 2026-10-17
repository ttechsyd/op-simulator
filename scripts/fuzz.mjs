// bundles fuzz.ts the same way server/build.mjs does, then runs it with the given args.
// the engine's build still imports a sibling package as TypeScript, so plain node can't load it.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "server", "package.json"))("esbuild");
const out = path.join(root, "scripts", "fuzz.bundle.mjs");

await build({
  entryPoints: [path.join(root, "scripts", "fuzz.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: out,
  logLevel: "warning",
  nodePaths: [path.join(root, "server", "node_modules")],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const run = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
process.exit(run.status ?? 1);
