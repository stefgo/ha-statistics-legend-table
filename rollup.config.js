import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import { defineConfig } from "rollup";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("./package.json");

export default defineConfig({
  input: "src/index.ts",
  output: {
    file: "dist/energy-custom-legend.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    replace({
      "process.env.NODE_ENV": JSON.stringify("production"),
      __CARD_VERSION__: JSON.stringify(pkg.version),
      preventAssignment: true,
    }),
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    json(),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: false,
    }),
  ],
  context: "window",
  onwarn: (warning) => {
    if (warning.code === "THIS_IS_UNDEFINED") return;
    console.warn(warning.message);
  },
});
