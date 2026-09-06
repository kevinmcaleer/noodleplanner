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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
if (/@babel\/runtime/.test(rewritten)) throw new Error("a bare @babel/runtime specifier survived the rewrite");
writeFileSync(join(target, "jspdf.es.min.js"), rewritten);

const version = JSON.parse(
  readFileSync(join(repo, "node_modules", "@babel", "runtime", "package.json"), "utf8"),
).version;
writeFileSync(join(bundled, "VERSION"), `${version}\n`);

console.log(
  `rewrote ${entry.length} bare import(s) and vendored ${needed.size} @babel/runtime ${version} helper(s): ` +
    [...needed].sort().join(", "),
);
