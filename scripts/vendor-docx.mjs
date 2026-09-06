#!/usr/bin/env node
/**
 * Copy the pinned `docx` release into static/vendor/docx.
 *
 * Only the self-contained ES module build is vendored: static/docx-export.js
 * imports it directly, and the same file runs under Node in
 * tests/test_pdf_docx_browser_export.mjs.
 */
import { vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "docx",
  dir: "docx",
  files: {
    "dist/index.mjs": "index.mjs",
    LICENSE: "LICENSE",
  },
});
