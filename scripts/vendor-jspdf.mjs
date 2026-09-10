#!/usr/bin/env node
/**
 * Copy the pinned `jspdf` release into static/vendor/jspdf.
 *
 * The ES module build is what static/pdf-export.js imports, and the same file
 * runs under Node in tests/test_pdf_docx_browser_export.mjs. That build is not
 * self-contained: it imports two `@babel/runtime` helpers by bare specifier,
 * which neither a bundler-less browser nor Node can resolve. So the helpers it
 * needs (seven of them, ~2.5 KB in total) are vendored alongside it and the
 * bare specifiers are rewritten to relative paths.
 *
 * The UMD build has no bare imports but only assigns to a global, which is a
 * worse fit for an ES module that has to run identically in both places.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { repo, vendorRoot, vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "jspdf",
  dir: "jspdf",
  files: {
    "dist/jspdf.es.min.js": "jspdf.es.min.js",
    LICENSE: "LICENSE",
  },
});

// --- resolve and vendor the @babel/runtime helpers the ES build needs -------

const HELPER_ROOT = join(repo, "node_modules", "@babel", "runtime", "helpers", "esm");
const target = join(vendorRoot, "jspdf");
const bundled = join(target, "babel");

// jsPDF's ES build also imports these two small ESM packages by bare
// specifier.  The app deliberately has no browser bundler, so keep the
// transitive imports beside the jsPDF bundle and point the bundle at them.
const fflateTarget = join(target, "fflate");
const fastPngTarget = join(target, "fast-png");
mkdirSync(fflateTarget, { recursive: true });
mkdirSync(fastPngTarget, { recursive: true });
copyFileSync(join(repo, "node_modules", "fflate", "esm", "index.mjs"), join(fflateTarget, "index.mjs"));
cpSync(join(repo, "node_modules", "fast-png", "lib-esm"), fastPngTarget, { recursive: true });
// fast-png publishes extensionless relative imports.  Browsers (and Node's
// strict ESM loader used by the export tests) require the `.js` suffix.
for (const file of fastPngFiles(fastPngTarget)) {
  const source = readFileSync(file, "utf8");
  const fixed = source.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_m, open, path, close) =>
    /\.[A-Za-z0-9]+$/.test(path) ? `${open}${path}${close}` : `${open}${path}.js${close}`,
  );
  if (fixed !== source) writeFileSync(file, fixed);
}

const bundle = readFileSync(join(target, "jspdf.es.min.js"), "utf8");
const entry = [...bundle.matchAll(/@babel\/runtime\/helpers\/([A-Za-z0-9_]+)/g)].map((m) => m[1]);
if (entry.length === 0) {
  throw new Error("jspdf.es.min.js no longer imports @babel/runtime; simplify this script");
}

// Walk the helpers' own relative imports so the vendored set is closed.
const needed = new Set();
const queue = [...entry];
while (queue.length) {
  const name = queue.shift();
  if (needed.has(name)) continue;
  needed.add(name);
  const path = join(HELPER_ROOT, `${name}.js`);
  if (!existsSync(path)) throw new Error(`@babel/runtime has no helper ${name}`);
  for (const m of readFileSync(path, "utf8").matchAll(/from "\.\/([^"]+)\.js"/g)) queue.push(m[1]);
}

mkdirSync(bundled, { recursive: true });
for (const name of needed) copyFileSync(join(HELPER_ROOT, `${name}.js`), join(bundled, `${name}.js`));

// Point the bundle at the vendored copies instead of the bare specifiers.
const rewritten = bundle.replace(
  /(["'])@babel\/runtime\/helpers\/([A-Za-z0-9_]+)\1/g,
  (_match, quote, name) => `${quote}./babel/${name}.js${quote}`,
);
const selfContained = rewritten
  .replace(/(["'])fflate\1/g, "$1./fflate/index.mjs$1")
  .replace(/(["'])fast-png\1/g, "$1./fast-png/index.js$1");
if (/@babel\/runtime|from["']fflate|from["']fast-png/.test(selfContained)) {
  throw new Error("a bare jsPDF dependency specifier survived the rewrite");
}
writeFileSync(join(target, "jspdf.es.min.js"), selfContained);

const version = JSON.parse(
  readFileSync(join(repo, "node_modules", "@babel", "runtime", "package.json"), "utf8"),
).version;
writeFileSync(join(bundled, "VERSION"), `${version}\n`);

console.log(
  `rewrote ${entry.length} bare import(s) and vendored ${needed.size} @babel/runtime ${version} helper(s): ` +
    [...needed].sort().join(", "),
);

function fastPngFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...fastPngFiles(path));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}
