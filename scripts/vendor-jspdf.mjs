#!/usr/bin/env node
/**
 * Copy the pinned `jspdf` release into static/vendor/jspdf.
 *
 * Only the ES module build is vendored: static/pdf-export.js imports it
 * directly, and the same file runs under Node in
 * tests/test_pdf_docx_browser_export.mjs.
 */
import { vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "jspdf",
  dir: "jspdf",
  files: {
    "dist/jspdf.es.min.js": "jspdf.es.min.js",
    LICENSE: "LICENSE",
  },
});
