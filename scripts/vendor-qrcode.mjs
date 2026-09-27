#!/usr/bin/env node
/**
 * Copy the pinned `qrcode-generator` release into static/vendor/qrcode.
 *
 * <np-qr-code> (static/components/qr-code/) draws the planning session's
 * join link as a QR code, so a phone can join by pointing its camera at the
 * host's screen (#1389, epic #1376). qrcode-generator is a dependency-free
 * encoder that ships a real ES module (dist/qrcode.mjs, `export default
 * qrcode`), so it is copied as it is: no shim. Its MIT licence is in the
 * file's own header; the package has no separate LICENSE file.
 */
import { vendor } from "./vendor-lib.mjs";

vendor({
  pkg: "qrcode-generator",
  dir: "qrcode",
  files: {
    "dist/qrcode.mjs": "qrcode.mjs",
    "README.md": "README.md",
  },
});
