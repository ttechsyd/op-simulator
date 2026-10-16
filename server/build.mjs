import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server.mjs",
  logLevel: "warning",
  // ws is CommonJS and asks for node builtins with require()
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
