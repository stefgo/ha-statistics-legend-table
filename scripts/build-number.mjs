/**
 * Local build counter for the version the card reports.
 *
 * The number rises with every build, so a reloaded dashboard shows one nobody
 * has seen before — if the console still prints the old one, the browser served
 * a cached bundle rather than the freshly deployed one. That is the whole point
 * of it; the released version stays the semver in `package.json`.
 *
 * The counter is local to the working copy (`.build-number` is not committed):
 * it answers "is this the bundle I just built?", not "which build is this
 * across machines".
 *
 * Unlike the sibling project this is not a code generator — rollup replaces the
 * placeholders in `src/version.ts` at build time, so nothing has to be written
 * into `src/`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BUILD_NUMBER_FILE = ".build-number";

/** Bumps the counter and returns the version parts for this build */
export function nextBuild(version) {
  const previous = existsSync(BUILD_NUMBER_FILE)
    ? Number.parseInt(readFileSync(BUILD_NUMBER_FILE, "utf8").trim(), 10)
    : 0;
  const build = Number.isFinite(previous) && previous > 0 ? previous + 1 : 1;

  writeFileSync(BUILD_NUMBER_FILE, `${build}\n`);

  const builtAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return { build, builtAt, full: `${version}+build.${build}` };
}
