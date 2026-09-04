#!/usr/bin/env node
/**
 * Copy the pinned `mppwriter` release from node_modules into the static
 * directory the browser loads it from.
 *
 * The front-end has no bundler, so the library is vendored rather than
 * imported from node_modules at runtime. This script is the only way the
 * vendored copy should change: bump the version in package.json, run
 * `npm install && npm run vendor:mppwriter`, commit the result. The VERSION
 * file it writes is what tests/test_mpp_browser_export.mjs checks.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const pinned = pkg.devDependencies?.mppwriter;
if (!pinned) throw new Error("package.json does not pin mppwriter in devDependencies");

const source = join(repo, "node_modules", "mppwriter");
if (!existsSync(join(source, "dist"))) {
  throw new Error(`mppwriter is not installed at ${source}; run \`npm install\` first`);
}
const installed = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
if (installed !== pinned) {
  throw new Error(`node_modules has mppwriter ${installed} but package.json pins ${pinned}; run \`npm install\``);
}

const target = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor", "mppwriter");
mkdirSync(target, { recursive: true });

const copied = [];
for (const name of readdirSync(join(source, "dist"))) {
  if (!name.endsWith(".js")) continue; // the browser needs the modules, not the .d.ts files
  copyFileSync(join(source, "dist", name), join(target, name));
  copied.push(name);
}
copyFileSync(join(source, "LICENSE"), join(target, "LICENSE"));
writeFileSync(join(target, "VERSION"), `${installed}\n`);

console.log(`vendored mppwriter ${installed}: ${copied.sort().join(", ")}, LICENSE, VERSION`);
