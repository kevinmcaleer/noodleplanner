/**
 * The browser side of the Markdown round-trip guarantee (issue #771).
 *
 * The page holds the plan text as-is; the only edits it makes to a plan the
 * user did not touch are the front-matter keys the app maintains:
 *
 *   rag         written after every render (persistRagToFrontMatter)
 *   version     bumped on save (incrementPlanVersion)
 *   last_saved  stamped on save (setLastSavedInFrontMatter)
 *
 * Each writer must change exactly one line, in place, leave every other byte
 * alone, and be a no-op when the value is already there. This runs those
 * writers, as the browser runs them, over the same corpus the Python guard
 * uses (tests/test_markdown_roundtrip.py).
 *
 *   node --test tests/test_markdown_roundtrip.mjs
 *
 * The writers live in static/script.js and static/version-history.js, which
 * are classic browser scripts, so their top-level function declarations are
 * lifted out by name and evaluated in a sandbox rather than required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const staticDir = join(repo, "packages", "noodle-web", "src", "noodle_web", "static");

/** Top-level `function name(` … `\n}` declarations from a classic script. */
function liftFunctions(file, names) {
  const source = readFileSync(join(staticDir, file), "utf8");
  const sandbox = {};
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf("\n}\n", start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

const fm = {
  ...liftFunctions("script.js", [
    "getVersionFromFrontMatter", "incrementVersion", "setVersionInFrontMatter",
    "getLastSavedFromFrontMatter", "setLastSavedInFrontMatter",
  ]),
  ...liftFunctions("version-history.js", ["getRagFromFrontMatter", "setRagInFrontMatter"]),
};

const corpus = [
  ...readdirSync(join(repo, "templates"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join("templates", d.name, "plan.md"))
    .filter((p) => { try { readFileSync(join(repo, p)); return true; } catch { return false; } }),
  ...readdirSync(join(repo, "tests", "fixtures", "roundtrip"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => join("tests", "fixtures", "roundtrip", n)),
].sort();
assert.ok(corpus.length >= 8, "corpus should hold the templates and the fixtures");

/** Lines that differ between two texts: [removed[], added[]]. */
function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  // single-line in-place edits keep the line count; an inserted key adds one
  const removed = [];
  const added = [];
  if (a.length === b.length) {
    a.forEach((line, i) => { if (line !== b[i]) { removed.push(line); added.push(b[i]); } });
    return [removed, added];
  }
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const tail = a.length - i;
  assert.deepEqual(a.slice(i), b.slice(b.length - tail), "change is not a single insertion");
  return [[], b.slice(i, b.length - tail)];
}

function hasFrontMatter(text) {
  return /^---\n[\s\S]*?\n---/.test(text);
}

const WRITERS = [
  {
    key: "rag",
    apply: (text) => fm.setRagInFrontMatter(text, "amber"),
    reapply: (text) => fm.setRagInFrontMatter(text, "amber"),
    expectLine: "rag: amber",
  },
  {
    key: "version",
    apply: (text) => fm.setVersionInFrontMatter(text, fm.incrementVersion(fm.getVersionFromFrontMatter(text) || "1.0")),
    reapply: (text) => fm.setVersionInFrontMatter(text, fm.getVersionFromFrontMatter(text)),
    expectLine: /^version: \d+\.\d+$/,
  },
  {
    key: "last_saved",
    apply: (text) => fm.setLastSavedInFrontMatter(text),
    reapply: (text) => fm.setLastSavedInFrontMatter(text),
    expectLine: /^last_saved: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  },
];

for (const path of corpus) {
  const text = readFileSync(join(repo, path), "utf8");

  for (const w of WRITERS) {
    test(`${path}: writing ${w.key} touches only that line`, () => {
      const out = w.apply(text);

      if (!hasFrontMatter(text)) {
        // the plan had no front matter: a block holding just this key is added
        assert.ok(out.endsWith(text), "the original text must follow the new front matter unchanged");
        const head = out.slice(0, out.length - text.length).split("\n");
        assert.equal(head[0], "---");
        assert.equal(head[2], "---");
        assert.equal(head.length, 4, `front matter should hold one key: ${JSON.stringify(head)}`);
        assert.match(head[1], w.expectLine instanceof RegExp ? w.expectLine : new RegExp(`^${w.expectLine}$`));
        return;
      }

      if (out === text) {
        // the value was already there: nothing may move
        const current = text.match(new RegExp(`^${w.key}:\\s*(.*)$`, "m"));
        assert.ok(current, `${w.key} unchanged but not present in the front matter`);
        return;
      }

      const [removed, added] = changedLines(text, out);
      assert.equal(added.length, 1, `expected one changed line, got ${added.length}: ${JSON.stringify(added)}`);
      assert.match(added[0], w.expectLine instanceof RegExp ? w.expectLine : new RegExp(`^${w.expectLine}$`));
      if (removed.length) {
        assert.equal(removed.length, 1);
        assert.ok(removed[0].startsWith(`${w.key}:`), `replaced a line that was not ${w.key}: ${removed[0]}`);
      }
      // the front-matter close and everything after it are untouched
      const bodyBefore = text.slice(text.indexOf("\n---", 3));
      const bodyAfter = out.slice(out.indexOf("\n---", 3));
      assert.equal(bodyAfter, bodyBefore, "the task outline and back matter must not move");
    });

    test(`${path}: writing ${w.key} twice changes nothing`, () => {
      const once = w.apply(text);
      assert.equal(w.reapply(once), once);
    });
  }
}

test("a value that is already there is not rewritten", () => {
  const text = "---\ntitle: T\nrag: green\nversion: 2.3\n---\nTask 1d\n";
  assert.equal(fm.setRagInFrontMatter(text, "green"), text);
  assert.equal(fm.setVersionInFrontMatter(text, "2.3"), text);
  assert.equal(fm.getRagFromFrontMatter(text), "green");
  assert.equal(fm.getVersionFromFrontMatter(text), "2.3");
});

test("an odd but valid front matter is edited in place, not duplicated", () => {
  // keys with unusual spacing, a quoted value, a nested list, no trailing newline
  const text = "---\ntitle:   Spaced   \nweird: 'q'\nResources:\n- @a: A, Role\nrag: red\n---\nTask 1d";
  const out = fm.setRagInFrontMatter(text, "green");
  assert.equal(out, "---\ntitle:   Spaced   \nweird: 'q'\nResources:\n- @a: A, Role\nrag: green\n---\nTask 1d");
  assert.equal((out.match(/^---$/gm) || []).length, 2, "must not add a second front matter block");
});
