import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { runtimeDeployPlugin } from "../deploy-runtime.mjs";

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
  plugins: [runtimeDeployPlugin("TPS-Finances (Dev)")],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
