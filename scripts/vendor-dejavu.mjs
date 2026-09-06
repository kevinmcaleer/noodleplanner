#!/usr/bin/env node
/**
 * Copy DejaVu Sans Mono from the pinned `dejavu-fonts-ttf` release into
 * static/vendor/dejavu.
 *
 * The browser PDF export embeds this font so that the report's box-drawing
 * and block characters and non-ASCII names render (jsPDF's built-in fonts
 * are Latin-1 only). One regular weight is enough for a monospace listing.
 */
import { vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "dejavu-fonts-ttf",
  dir: "dejavu",
  files: {
    "ttf/DejaVuSansMono.ttf": "DejaVuSansMono.ttf",
    LICENSE: "LICENSE",
  },
});
