#!/usr/bin/env node
/**
 * Copy the pinned `exceljs` browser build from node_modules into the static
 * directory the browser loads it from.
 *
 * The front-end has no bundler and the CSP allows scripts from this origin
 * only, so the library is vendored rather than loaded from a CDN. This
 * script is the only way the vendored copy should change: bump the version
 * in package.json, run `npm install && npm run vendor:exceljs`, commit the
 * result. The VERSION file it writes is what
 * tests/test_excel_browser_export.mjs checks.
 *
 * Only the minified UMD bundle (dist/exceljs.min.js) is copied: it is what
 * static/excel-export.js imports, in the browser and in the Node tests.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const pinned = pkg.devDependencies?.exceljs;
if (!pinned) throw new Error("package.json does not pin exceljs in devDependencies");

const source = join(repo, "node_modules", "exceljs");
if (!existsSync(join(source, "dist", "exceljs.min.js"))) {
  throw new Error(`exceljs is not installed at ${source}; run \`npm install\` first`);
}
const installed = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
if (installed !== pinned) {
  throw new Error(`node_modules has exceljs ${installed} but package.json pins ${pinned}; run \`npm install\``);
}

const target = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor", "exceljs");
mkdirSync(target, { recursive: true });

copyFileSync(join(source, "dist", "exceljs.min.js"), join(target, "exceljs.min.js"));
copyFileSync(join(source, "LICENSE"), join(target, "LICENSE"));
writeFileSync(join(target, "VERSION"), `${installed}\n`);

console.log(`vendored exceljs ${installed}: exceljs.min.js, LICENSE, VERSION`);
