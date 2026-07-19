import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDeployPlugin } from "../deploy-runtime.mjs";

const sourceFolder = basename(dirname(fileURLToPath(import.meta.url)));

const prod = process.argv[2] === "production";
const context = await esbuild.context({
  banner: { js: "/* Generated TPS Finances bundle. */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [runtimeDeployPlugin(sourceFolder)],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
