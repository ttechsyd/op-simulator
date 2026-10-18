import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server.mjs",
  // firebase-admin drags in grpc and friends; it stays a normal node module next to the bundle
  external: ["firebase-admin", "firebase-admin/*"],
  logLevel: "warning",
  // ws is CommonJS and asks for node builtins with require()
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
