# docx (vendored)

The self-contained ES module build of
[`docx`](https://www.npmjs.com/package/docx), copied here because this
front-end has no bundler and no npm build step. MIT licensed; see LICENSE.

`VERSION` records the release in this directory. It is pinned in the root
`package.json` and copied by a script; never edit these files by hand.

To move to a new release:

```bash
# in the repository root
npm install --save-dev --save-exact docx@<version>
npm run vendor:docx
```

`tests/test_pdf_docx_browser_export.mjs` fails if `VERSION` does not match
the pinned release, or if the file here differs from the installed package.

Used by `static/docx-export.js`, which builds the communications-plan Word
document in the browser (issue #792).
