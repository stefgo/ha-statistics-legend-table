import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import { defineConfig } from "rollup";
import { createRequire } from "node:module";
import { nextBuild } from "./scripts/build-number.mjs";

const pkg = createRequire(import.meta.url)("./package.json");

// Bumped once per rollup run — a `watch` session keeps the number it started
// with, exactly like the build it stands in for.
const { build, builtAt, full } = nextBuild(pkg.version);
console.log(`energy-custom-legend ${full} (${builtAt})`);

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
      __CARD_VERSION__: JSON.stringify(full),
      __CARD_SEMVER__: JSON.stringify(pkg.version),
      __CARD_BUILD__: JSON.stringify(build),
      __CARD_BUILD_TIME__: JSON.stringify(builtAt),
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
