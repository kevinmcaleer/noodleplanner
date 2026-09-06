# exceljs (vendored)

The browser build of [`exceljs`](https://www.npmjs.com/package/exceljs),
copied here because this front-end has no bundler and its Content Security
Policy only allows scripts from this origin. MIT licensed; see LICENSE.

`VERSION` records the release in this directory. It is pinned in the root
`package.json` and copied by a script; never edit these files by hand.

To move to a new release:

```bash
# in the repository root
npm install --save-dev --save-exact exceljs@<version>
npm run vendor:exceljs
```

`tests/test_excel_browser_export.mjs` fails if `VERSION` does not match the
pinned release, or if `exceljs.min.js` differs from the installed package.

Used by `static/excel-export.js`, which builds the Excel and CSV exports
(the plan workbook, and the RAID log, benefits and budget workbooks) and
reads the RAID log and budget `.xlsx` imports, all in the browser
(issue #790).
