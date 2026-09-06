/**
 * Shared implementation of the `scripts/vendor-<lib>.mjs` copy scripts.
 *
 * The front-end has no bundler, so each third-party library the browser
 * loads is copied from node_modules into static/vendor/<name>/ and committed.
 * This is the only way a vendored copy should change: bump the exact version
 * in package.json, run `npm install && npm run vendor:<name>`, commit the
 * result. The VERSION file written here is what the Node tests check.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const vendorRoot = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor");

/**
 * @param {object} spec
 * @param {string} spec.pkg npm package name, pinned in package.json devDependencies
 * @param {string} spec.dir directory name under static/vendor/
 * @param {Record<string, string>} spec.files package-relative source -> vendored file name
 */
export function vendor({ pkg, dir, files }) {
  const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const pinned = manifest.devDependencies?.[pkg];
  if (!pinned) throw new Error(`package.json does not pin ${pkg} in devDependencies`);

  const source = join(repo, "node_modules", pkg);
  if (!existsSync(join(source, "package.json"))) {
    throw new Error(`${pkg} is not installed at ${source}; run \`npm install\` first`);
  }
  const installed = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
  if (installed !== pinned) {
    throw new Error(`node_modules has ${pkg} ${installed} but package.json pins ${pinned}; run \`npm install\``);
  }

  const target = join(vendorRoot, dir);
  mkdirSync(target, { recursive: true });
  const copied = [];
  for (const [from, to] of Object.entries(files)) {
    const path = join(source, from);
    if (!existsSync(path)) throw new Error(`${pkg}@${installed} has no ${from}`);
    copyFileSync(path, join(target, to));
    copied.push(to);
  }
  writeFileSync(join(target, "VERSION"), `${installed}\n`);
  console.log(`vendored ${pkg} ${installed} into static/vendor/${dir}: ${copied.join(", ")}, VERSION`);
}
