# jsPDF (vendored)

The ES module build of [`jspdf`](https://www.npmjs.com/package/jspdf),
copied here because this front-end has no bundler and no npm build step.
MIT licensed; see LICENSE.

`VERSION` records the release in this directory. It is pinned in the root
`package.json` and copied by a script; never edit these files by hand.

To move to a new release:

```bash
# in the repository root
npm install --save-dev --save-exact jspdf@<version>
npm run vendor:jspdf
```

`tests/test_pdf_docx_browser_export.mjs` fails if `VERSION` does not match
the pinned release, or if the file here differs from the installed package.

Used by `static/pdf-export.js`, which builds the project-plan PDF in the
browser (issue #792). The font it embeds lives in `../dejavu`.
