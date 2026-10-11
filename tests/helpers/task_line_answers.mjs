/**
 * Answers for tests/test_task_line_contract.py: what the browser-side code
 * makes of each task line, so the Python test can hold metadata.py to it.
 *
 * Reads a JSON array of lines on stdin and writes, per line:
 *   engine    extractMetadata() from static/engine/tokeniser.js
 *   form      parseTaskLine() from script.js (task-tokenizer.js underneath),
 *             plus durationToken: the duration as the tokenizer saw it, unit
 *             included, since parseTaskLine keeps only the digits
 *   roundtrip the line after openTaskForm() + saveTask() with no edits, or null
 *
 * One process answers for the whole corpus; the Python side spawns it once per
 * module, not once per line.
 */
import { readFileSync } from "node:fs";
import { extractMetadata } from "../../packages/noodle-web/src/noodle_web/static/engine/tokeniser.js";
import { makeTaskForm } from "./task_form_sandbox.mjs";

const lines = JSON.parse(readFileSync(0, "utf8"));
const form = makeTaskForm();

const out = lines.map((line) => {
  let roundtrip = null;
  let error = null;
  try {
    // "First" gives a leading `*` something to depend on; a heading never does.
    form.open(`# Plan\nFirst 1d\n${line}\n`, 3);
    roundtrip = form.save().split("\n")[2];
  } catch (e) {
    error = String(e && e.stack || e);
  }
  const duration = form.tokenizerValues(line).tokens.find((t) => t.type === "duration");
  const parsed = { ...form.parseTaskLine(line, 3), durationToken: duration ? duration.text : "" };
  return { engine: extractMetadata(line), form: parsed, roundtrip, error };
});
process.stdout.write(JSON.stringify(out));
