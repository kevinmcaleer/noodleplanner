/**
 * The portfolio deck, compared against a committed reference (issue #778).
 *
 * #778 speeds up the export, and its acceptance criteria say the decks must
 * come out unchanged in content and layout. Speed work on the export path is
 * exactly the kind of change that can shift a slide without anyone noticing,
 * so this pins the deck: build it from a fixed payload and compare every
 * slide's text, fill colours, table shape and image count against
 * `tests/fixtures/pptx/portfolio-deck-reference.json`.
 *
 * The reference is the deck's *structure*, not its bytes: a .pptx is a zip
 * carrying timestamps, so the bytes differ run to run while the slides do not.
 *
 *   node --test tests/test_portfolio_deck_reference.mjs
 *
 * If a change to the deck is intended, regenerate the reference and review the
 * diff as part of the change:
 *
 *   UPDATE_PPTX_REFERENCE=1 node --test tests/test_portfolio_deck_reference.mjs
 *
 * What this does *not* cover is whether the timeline PNGs themselves are
 * unchanged -- the payload here carries a fixed image. That half is
 * tests/test_portfolio_timeline_capture.mjs, which checks the batched capture
 * produces byte-identical images to the per-project capture it replaced.
 * Together they cover the chain: same images in, same deck out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildPortfolioDeck, deckBytes } from "../packages/noodle-web/src/noodle_web/static/pptx-export.js";

const here = dirname(fileURLToPath(import.meta.url));
const payloadPath = join(here, "fixtures", "pptx", "portfolio-payload.json");
const referencePath = join(here, "fixtures", "pptx", "portfolio-deck-reference.json");

const payload = JSON.parse(readFileSync(payloadPath, "utf8"));

/** Slide text is XML-escaped in the file ("Risks &amp; Issues"). */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * A slide-by-slide summary of a deck: what it says, what colour it says it
 * in, and how it is laid out. Deliberately not the raw XML -- PptxGenJS is
 * free to reorder attributes, and this should fail for a changed deck, not a
 * changed serialiser.
 */
async function deckSummary(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  const slides = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async("string");
    slides.push({
      texts: [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeEntities(m[1])),
      fills: [...xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"\/>/g)].map((m) => m[1].toUpperCase()),
      tables: (xml.match(/<a:tbl>/g) || []).length,
      rows: (xml.match(/<a:tr /g) || []).length,
      images: (xml.match(/<p:pic>/g) || []).length,
      // Geometry, to the nearest EMU: this is the "layout" half of "content
      // and layout", and it is what moves if a slide builder is touched.
      frames: [...xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)]
        .map((m) => m.slice(1).join(",")),
    });
  }
  return { slideCount: slides.length, slides };
}

test("the portfolio deck matches the committed reference", async () => {
  const summary = await deckSummary(await deckBytes(buildPortfolioDeck(payload.portfolio_data, payload.project_reports)));

  if (process.env.UPDATE_PPTX_REFERENCE === "1") {
    writeFileSync(referencePath, JSON.stringify(summary, null, 2) + "\n");
    console.log(`reference updated: ${referencePath}`);
    return;
  }

  const reference = JSON.parse(readFileSync(referencePath, "utf8"));

  assert.equal(summary.slideCount, reference.slideCount, "slide count changed");
  for (let i = 0; i < reference.slides.length; i++) {
    const got = summary.slides[i];
    const want = reference.slides[i];
    const where = `slide ${i + 1}`;
    assert.deepEqual(got.texts, want.texts, `${where}: text changed`);
    assert.deepEqual(got.fills, want.fills, `${where}: fill colours changed`);
    assert.deepEqual(got.frames, want.frames, `${where}: shape geometry changed`);
    assert.equal(got.tables, want.tables, `${where}: table count changed`);
    assert.equal(got.rows, want.rows, `${where}: table row count changed`);
    assert.equal(got.images, want.images, `${where}: image count changed`);
  }
});

test("the deck carries one timeline image per project, plus the portfolio's", async () => {
  const bytes = await deckBytes(buildPortfolioDeck(payload.portfolio_data, payload.project_reports));
  const summary = await deckSummary(bytes);
  const images = summary.slides.reduce((total, slide) => total + slide.images, 0);
  // One per project report, one on the portfolio overview slide.
  assert.equal(images, payload.project_reports.length + 1);
});
