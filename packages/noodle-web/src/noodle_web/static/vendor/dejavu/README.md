# DejaVu Sans Mono (vendored)

`DejaVuSansMono.ttf` from the
[`dejavu-fonts-ttf`](https://www.npmjs.com/package/dejavu-fonts-ttf) package,
copied here because the browser PDF export embeds it. Licensed under the
Bitstream Vera / DejaVu licence; see LICENSE.

`VERSION` records the release in this directory. It is pinned in the root
`package.json` and copied by a script; never edit these files by hand.

To move to a new release:

```bash
# in the repository root
npm install --save-dev --save-exact dejavu-fonts-ttf@<version>
npm run vendor:dejavu
```

`tests/test_pdf_docx_browser_export.mjs` fails if `VERSION` does not match
the pinned release, or if the file here differs from the installed package.

Why this font: jsPDF's built-in fonts (Helvetica, Courier, Times) can only
show Latin-1 text, and the project-plan report is a monospace listing that
uses box-drawing (`├ ─ ═ ┤ │`), block (`█ ░`) and geometric (`◆`)
characters. DejaVu Sans Mono is a fixed-pitch face that covers Latin
(including the extended ranges), Greek, Cyrillic, general punctuation,
currency symbols, box drawing, block elements and geometric shapes in
340 KB. It does not cover CJK ideographs or emoji; see
`docs/reference/export-formats.rst`.

Used by `static/pdf-export.js` (issue #792), which fetches the file from
`/static/vendor/dejavu/DejaVuSansMono.ttf` when an export is made.
