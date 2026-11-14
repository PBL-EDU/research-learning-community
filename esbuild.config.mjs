import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import path from "node:path";

const banner = "/* 研究性学习社区 · Obsidian 插件（esbuild 打包） */";
const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  alias: {
    "@rlc/contract": path.resolve("packages/contract/src/index.ts"),
    "@rlc/vault-core": path.resolve("packages/vault-core/src/index.ts"),
  },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  console.log("✅ main.js 已生成");
} else {
  await context.watch();
}
