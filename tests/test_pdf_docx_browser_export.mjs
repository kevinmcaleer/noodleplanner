/**
 * The browser's PDF and Word exports (static/pdf-export.js, static/docx-export.js),
 * exercised in Node (issue #792).
 *
 * Both exports are built in the browser from the plan the page has already had
 * scheduled; the only network request either makes is for the font the PDF
 * embeds. The modules keep their builders pure — no fetch, no DOM — so the
 * exact code a browser runs is what these tests run.
 *
 *   node --test tests/test_pdf_docx_browser_export.mjs
 *
 * What parity means here:
 *
 * * PDF — the Python exporter (`export_to_pdf`) is a thin wrapper: it renders
 *   `text_to_markdown_table()` into a monospaced PDF. So the content parity
 *   that matters is the report text, compared line by line against Python for
 *   every plan in the corpus. The PDF itself is then checked by extracting its
 *   text back out with pdfjs.
 * * DOCX — compared structurally against `export_comms_to_docx()`: the same
 *   text runs, the same table shape, landscape orientation, and borders.
 *
 * The comparisons need the repo's Python venv; they skip without it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  FONT_URL,
  FONT_MISSING_MESSAGE,
  buildPdf,
  buildReportText,
  fetchFont,
  fontCoverage,
  pdfFilename,
  substituteUncovered,
} from "../packages/noodle-web/src/noodle_web/static/pdf-export.js";
import {
  HEADERS,
  buildCommsDocument,
  buildCommsDocx,
  docxFilename,
} from "../packages/noodle-web/src/noodle_web/static/docx-export.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repo}/.venv/bin/python`;
const hasPython = existsSync(python);
const fontPath = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor", "dejavu", "DejaVuSansMono.ttf");

/** Every plan the round-trip corpus already covers, plus the bundled templates. */
const CORPUS = [
  ...readdirSync(join(repo, "templates"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join("templates", d.name, "plan.md"))
    .filter((p) => existsSync(join(repo, p))),
  ...readdirSync(join(repo, "tests", "fixtures", "roundtrip"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => join("tests", "fixtures", "roundtrip", n)),
].sort();

/**
 * The /api/parse payload and the Python ASCII report for one plan, in a single
 * subprocess so the two cannot come from different parses.
 */
function pythonSide(planPath) {
  const script = `
import json, sys, logging
logging.disable(logging.CRITICAL)
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-web/src`)})
from noodle_web.plan_service import PlanService
from noodle_core.exporters import text_to_markdown_table
from noodle_core.format_converter import convert_plan_format_to_standard
plan = open(${JSON.stringify(join(repo, planPath))}, encoding="utf-8").read()
r = PlanService().parse(plan)
ascii_out = text_to_markdown_table(
    convert_plan_format_to_standard(plan), is_yaml=False,
    project_name=r.project_name, terminal_width=120, original_text=plan,
)
print(json.dumps({
    "parse": {"success": r.success, "project_name": r.project_name, "tasks": r.tasks,
              "front_matter": r.front_matter, "resource_map": r.resource_map,
              "comms_items": r.comms_items},
    "ascii": ascii_out,
}))
`;
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString());
}

/** The Word document Python produces for the same comms items. */
function pythonCommsDocx(items, projectName) {
  const script = `
import base64, json, sys, logging
logging.disable(logging.CRITICAL)
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
from noodle_core.format_converter import export_comms_to_docx
data = export_comms_to_docx(json.loads(${JSON.stringify(JSON.stringify(items))}), ${JSON.stringify(projectName)})
print(base64.b64encode(data).decode())
`;
  return Buffer.from(execFileSync(python, ["-c", script], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString().trim(), "base64");
}

// --- PDF: the report text matches Python, line for line ----------------------

for (const planPath of CORPUS) {
  test(`${planPath}: the browser report text matches Python's`, { skip: !hasPython }, () => {
    const { parse, ascii } = pythonSide(planPath);
    assert.ok(parse.success, `${planPath} did not parse`);

    const js = buildReportText(parse, { projectName: parse.project_name });
    const expected = ascii.split("\n");
    const actual = js.split("\n");

    // Python's table ends without the trailing newline the JS builder keeps.
    while (expected.length && expected[expected.length - 1] === "") expected.pop();
    while (actual.length && actual[actual.length - 1] === "") actual.pop();

    assert.equal(actual.length, expected.length, "line count differs");
    for (let i = 0; i < expected.length; i++) {
      assert.equal(actual[i], expected[i], `line ${i + 1} differs`);
    }
  });
}

// --- PDF: the file carries that text, and Unicode survives -------------------

/** buildPdf returns the jsPDF document; these tests want the bytes. */
function pdfBytes(title, report, fontBytes, options) {
  const { doc, warnings } = buildPdf(title, report, fontBytes, options);
  return { bytes: new Uint8Array(doc.output("arraybuffer")), warnings };
}

test("the PDF contains the report text and keeps non-ASCII names", { skip: !hasPython }, async () => {
  const { parse } = pythonSide("tests/fixtures/roundtrip/kitchen-sink.md");
  const report = buildReportText(parse, { projectName: parse.project_name });
  const fontBytes = new Uint8Array(readFileSync(fontPath));
  const { bytes } = pdfBytes(parse.project_name, report, fontBytes);

  assert.deepEqual([...bytes.subarray(0, 5)], [...Buffer.from("%PDF-")], "not a PDF");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  assert.ok(doc.numPages >= 1);

  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    text += content.items.map((i) => i.str).join("") + "\n";
  }

  // the title and a sample of task names from the fixture
  assert.match(text, /Kitchen Sink/);
  for (const name of ["Kick-off workshop", "Wireframes", "Deploy"]) {
    assert.ok(text.includes(name), `${name} missing from the extracted PDF text`);
  }
  // the fixture's non-ASCII names are not mangled into the missing-glyph box
  assert.ok(text.includes("Kévin") || text.includes("Kevin"), "author name lost");
});

test("page size follows the setting, and both sizes render", { skip: !hasPython }, () => {
  const { parse } = pythonSide("templates/software_delivery/plan.md");
  const report = buildReportText(parse, { projectName: parse.project_name });
  const fontBytes = new Uint8Array(readFileSync(fontPath));

  const a4 = pdfBytes(parse.project_name, report, fontBytes, { pageSize: "a4" }).bytes;
  const letter = pdfBytes(parse.project_name, report, fontBytes, { pageSize: "letter" }).bytes;
  for (const bytes of [a4, letter]) {
    assert.deepEqual([...bytes.subarray(0, 5)], [...Buffer.from("%PDF-")]);
    assert.ok(bytes.length > 1000, "suspiciously small PDF");
  }
  assert.notEqual(a4.length, letter.length, "the two page sizes produced identical bytes");
});

test("characters the font cannot draw are substituted, not dropped", () => {
  const covered = fontCoverage(new Uint8Array(readFileSync(fontPath)));
  assert.ok(covered.has("A".codePointAt(0)), "font coverage looks empty");
  assert.ok(covered.has("é".codePointAt(0)), "DejaVu should cover Latin-1 accents");

  // DejaVu Sans Mono has no CJK; those code points must be substituted
  const source = "Plan 日本語 ok";
  const { text, missing } = substituteUncovered(source, covered);
  assert.ok(text.includes("Plan") && text.includes("ok"), "ASCII text was damaged");
  assert.ok(!text.includes("日"), "an uncovered glyph survived unsubstituted");
  assert.equal([...text].length, [...source].length, "substitution changed the length");
  assert.deepEqual(missing.sort(), ["日", "本", "語"].sort(), "missing glyphs not reported");
});

test("a missing font stops the export instead of producing a broken PDF", async () => {
  const { exportPdfInBrowser } = await import("../packages/noodle-web/src/noodle_web/static/pdf-export.js");
  const requested = [];
  const failing = async (url) => {
    requested.push(String(url));
    return { ok: false };
  };
  // fetchFont reports the failure as null...
  assert.equal(await fetchFont(FONT_URL, failing), null);
  // ...and the export turns that into a message the user sees
  await assert.rejects(
    exportPdfInBrowser({ success: true, tasks: [] }, "", { fetch: failing, download: () => {} }),
    { message: FONT_MISSING_MESSAGE },
  );
  assert.deepEqual(requested, [FONT_URL, FONT_URL]);
});

test("file names are safe", { skip: !hasPython }, () => {
  const { parse } = pythonSide("tests/fixtures/roundtrip/kitchen-sink.md");
  const name = pdfFilename(parse, parse.project_name);
  assert.match(name, /\.pdf$/);
  assert.ok(!/[\\/:*?"<>|]/.test(name), `unsafe characters in ${name}`);
});

// --- DOCX: structural parity with the Python export --------------------------

const COMMS = [
  { id: 1, activity: "Weekly status update", audience: "Steering Board", content: "Progress summary", frequency: "Weekly", channel: "Email", owner: "Kévin", status: "Active" },
  { id: 2, activity: "Sprint demo", audience: "Team", content: "What shipped", frequency: "Fortnightly", channel: "Teams", owner: "Adam", status: "Planned" },
];

async function docxParts(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  return {
    xml,
    texts: [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]),
    rows: (xml.match(/<w:tr[ >]/g) || []).length,
    cells: (xml.match(/<w:tc>/g) || []).length,
    landscape: /w:orient="landscape"/.test(xml),
    borders: /<w:tblBorders>/.test(xml),
  };
}

test("the Word document carries the same text as Python's", { skip: !hasPython }, async () => {
  const browser = await docxParts(await buildCommsDocx(COMMS, "Comms Test"));
  const py = await docxParts(pythonCommsDocx(COMMS, "Comms Test"));

  // every header and every cell value Python writes is present in ours
  for (const header of HEADERS) {
    assert.ok(browser.texts.includes(header), `header ${header} missing`);
  }
  for (const item of COMMS) {
    for (const value of [item.activity, item.audience, item.content, item.frequency, item.channel, item.owner, item.status]) {
      assert.ok(browser.texts.some((t) => t.includes(value)), `${value} missing from the browser document`);
      assert.ok(py.texts.some((t) => t.includes(value)), `${value} missing from the Python document`);
    }
  }
  assert.ok(browser.texts.some((t) => t.includes("Kévin")), "non-ASCII owner lost");
});

test("the Word table has the same shape as Python's", { skip: !hasPython }, async () => {
  const browser = await docxParts(await buildCommsDocx(COMMS, "Comms Test"));
  const py = await docxParts(pythonCommsDocx(COMMS, "Comms Test"));

  assert.equal(browser.rows, py.rows, "row count differs");
  assert.equal(browser.cells, py.cells, "cell count differs");
  assert.equal(browser.rows, COMMS.length + 1, "expected one row per item plus a header");
});

test("the Word document is landscape with table borders, as Python's is", { skip: !hasPython }, async () => {
  const browser = await docxParts(await buildCommsDocx(COMMS, "Comms Test"));
  const py = await docxParts(pythonCommsDocx(COMMS, "Comms Test"));

  assert.equal(browser.landscape, true, "browser document is not landscape");
  assert.equal(py.landscape, true, "the Python document was expected to be landscape");
  assert.equal(browser.borders, true, "browser table has no borders");
});

test("an empty comms plan still produces a valid document", async () => {
  const bytes = await buildCommsDocx([], "Empty");
  assert.deepEqual([...bytes.subarray(0, 2)], [...Buffer.from("PK")], "not a zip");
  const { texts } = await docxParts(bytes);
  assert.ok(texts.some((t) => /No communications plan items/i.test(t)), "no empty-state message");
});

test("the document builder is pure and file names are safe", () => {
  assert.ok(buildCommsDocument(COMMS, "X"), "builder returned nothing");
  const name = docxFilename('Project "Q3" / plan');
  assert.match(name, /\.docx$/);
  assert.ok(!/[\\/:*?"<>|]/.test(name), `unsafe characters in ${name}`);
});
