# mppwriter (vendored)

Built output of [`mppwriter`](https://www.npmjs.com/package/mppwriter), the
TypeScript port of pymppwriter, copied here because this front-end has no
bundler and no npm build step. MIT licensed; see LICENSE.

To refresh after a release:

```bash
npm pack mppwriter                       # or: cd ../pymppwriter/js && npm run build
tar -xzf mppwriter-*.tgz
cp package/dist/*.js path/to/static/vendor/mppwriter/
```
