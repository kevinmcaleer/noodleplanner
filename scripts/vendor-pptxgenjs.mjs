#!/usr/bin/env node
/**
 * Copy the pinned `pptxgenjs` release into static/vendor/pptxgenjs.
 *
 * It is an ES module that the same static/pptx-export.js can import in the
 * browser and under Node in the tests. It is not fully self-contained,
 * though: pptxgenjs 4.0.1's ES build externalizes JSZip as
 * `import JSZip from 'jszip'` rather than bundling it inline. That is a bare
 * module specifier, which Node resolves against node_modules but the
 * browser rejects outright ("Failed to resolve module specifier 'jszip'" —
 * issue #977 / kevinmcaleer/Snakie#977), since browser ES modules only
 * accept specifiers starting with "/", "./", "../", or a full URL.
 *
 * So jszip is vendored too (scripts/vendor-jszip.mjs, run first by
 * `npm run vendor`) and the bare specifier below is rewritten to a relative
 * path pointing at its ES module shim, the same way vendor-jspdf.mjs
 * rewrites jspdf's bare @babel/runtime imports.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { vendorRoot, vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "pptxgenjs",
  dir: "pptxgenjs",
  files: {
    "dist/pptxgen.es.js": "pptxgen.es.js",
    "LICENSE": "LICENSE",
  },
});

const target = join(vendorRoot, "pptxgenjs");
const file = join(target, "pptxgen.es.js");
const original = readFileSync(file, "utf8");
const rewritten = original.replace("import JSZip from 'jszip';", "import JSZip from \"../jszip/jszip.esm.mjs\";");
if (rewritten === original) {
  throw new Error(
    "pptxgen.es.js no longer has the expected bare `import JSZip from 'jszip'`; " +
      "update this rewrite (and check whether jszip is now bundled inline, in which " +
      "case this rewrite and the vendored jszip copy may no longer be needed)",
  );
}
if (/from ['"]jszip['"]/.test(rewritten)) {
  throw new Error("a bare `jszip` specifier survived the rewrite");
}
writeFileSync(file, rewritten);

console.log("rewrote the bare `jszip` import in pptxgen.es.js to the vendored jszip shim");
