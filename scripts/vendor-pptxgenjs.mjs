#!/usr/bin/env node
/**
 * Copy the pinned `pptxgenjs` release into static/vendor/pptxgenjs.
 *
 * The bundle build is vendored: it carries JSZip inside it, so the browser
 * needs nothing else, and it is an ES module that the same static/pptx-export.js
 * can import in the browser and under Node in the tests.
 */
import { vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "pptxgenjs",
  dir: "pptxgenjs",
  files: {
    "dist/pptxgen.es.js": "pptxgen.es.js",
    "LICENSE": "LICENSE",
  },
});
