/**
 * The task-line grammar, as the engine sees it (issue #793).
 *
 * There is only one grammar and it lives in static/task-tokenizer.js — the
 * same file the syntax highlighter and the editor's parseTaskLine read a line
 * with (#748). This module is the ES-module face of it, so the scheduler and
 * the Node tests can `import` what the browser loads as a classic script; it
 * holds no patterns of its own.
 *
 * In a browser or a worker the classic script may already have run (index.html
 * loads it, a worker can importScripts it), in which case the global it
 * defines is used as is.
 */
import { parseDurationToDays } from "./date-math.js";

async function loadSharedTokenizer() {
  if (typeof globalThis !== "undefined" && globalThis.TaskLineTokenizer) {
    return globalThis.TaskLineTokenizer;
  }
  const loaded = await import("../task-tokenizer.js");
  // Node hands the CommonJS exports back as `default`; a browser evaluates the
  // file as a module, whose only effect is the global it assigns.
  return loaded.default || (typeof globalThis !== "undefined" ? globalThis.TaskLineTokenizer : null);
}

const shared = await loadSharedTokenizer();
if (!shared || typeof shared.extractMetadata !== "function") {
  throw new Error("task-tokenizer.js did not provide TaskLineTokenizer");
}

/** @see TaskLineTokenizer.extractMetadata — noodle_core's extract_metadata. */
export const extractMetadata = shared.extractMetadata;
/** @see TaskLineTokenizer.parseRecurrence — noodle_core's parse_recurrence. */
export const parseRecurrence = shared.parseRecurrence;
/** @see TaskLineTokenizer.bankersRound — Python's round(). */
export const bankersRound = shared.bankersRound;
/** Source spans for the syntax highlighter, from the same grammar. */
export const tokenize = shared.tokenize;
/** The editor's reading of a line, from the same grammar. */
export const lineMetadata = shared.metadata;

export { parseDurationToDays };

export default shared;
