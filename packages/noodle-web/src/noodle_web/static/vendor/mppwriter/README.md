# mppwriter (vendored)

Built output of [`mppwriter`](https://www.npmjs.com/package/mppwriter), the
TypeScript port of pymppwriter, copied here because this front-end has no
bundler and no npm build step. MIT licensed; see LICENSE.

`VERSION` records the release in this directory. It is pinned in the root
`package.json` and copied by a script; never edit these files by hand.

To move to a new release:

```bash
# in the repository root
npm install --save-dev --save-exact mppwriter@<version>
npm run vendor:mppwriter
```

`tests/test_mpp_browser_export.mjs` fails if `VERSION` does not match the
pinned release, or if the files here differ from the installed package.

Used by `static/mpp-export.js`, which builds and reads native `.mpp` files in
the browser (issue #770).
