/**
 * Native .mpp export, built in the browser.
 *
 * The scheduling stays on the server — `/api/mpp/model` returns the scheduled
 * plan as JSON — and this turns that model into a Microsoft Project file with
 * the vendored mppwriter library. Nothing but the model crosses the network,
 * so a deployment needs no pymppwriter and no template on the server's disk;
 * the template is served as a static asset instead.
 *
 * Falls back to the server-side exporter when the template asset is missing.
 */
import { MppWriter } from "./vendor/mppwriter/index.js";

/** Where the deployment puts the template it saved from Microsoft Project. */
export const TEMPLATE_URL = "/static/mpp-template.mpp";

/** ISO strings from the model are wall-clock, and mppwriter reads dates in UTC. */
function toDate(iso) {
  const [date, time = "00:00:00"] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

/** The JSON model from /api/mpp/model, as mppwriter's Project. */
export function modelToProject(model) {
  return {
    title: model.title,
    start: toDate(model.start),
    tasks: model.tasks.map((t) => ({
      uid: t.uid,
      name: t.name,
      start: toDate(t.start),
      finish: toDate(t.finish),
      durationDays: t.durationDays,
      outlineLevel: t.outlineLevel,
      parentUid: t.parentUid,
      percentComplete: t.percentComplete,
      taskType: t.taskType,
      notes: t.notes,
    })),
    relations: model.relations.map((r) => ({
      predUid: r.predUid,
      succUid: r.succUid,
      type: r.type,
      lagDays: r.lagDays,
    })),
    resources: model.resources.map((r) => ({ uid: r.uid, name: r.name })),
    assignments: model.assignments.map((a) => ({
      taskUid: a.taskUid,
      resourceUid: a.resourceUid,
      units: a.units,
    })),
    comments: model.comments,
  };
}

/**
 * Build the file. Pure: no fetch, no DOM — which is what lets the Node tests
 * exercise the same code path the browser runs.
 */
export function buildMpp(model, templateBytes, onWarning) {
  const writer = new MppWriter(templateBytes, {
    onWarning: onWarning ?? ((w) => console.warn("[mpp]", w.message)),
  });
  return writer.build(modelToProject(model));
}

/** The template, or null when the deployment has not provided one. */
export async function fetchTemplate(url = TEMPLATE_URL) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // a compound file starts with the OLE magic; anything else is an error
    // page served with a 200
    const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return magic.every((b, i) => bytes[i] === b) ? bytes : null;
  } catch {
    return null;
  }
}

async function fetchModel(planText, projectName) {
  const response = await fetch("/api/mpp/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_text: planText, project_name: projectName || null }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || "Could not schedule the plan");
  }
  return response.json();
}

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.ms-project" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export in the browser. Returns false when the template asset is absent, so
 * the caller can fall back to the server-side export.
 */
export async function exportMppInBrowser(planText, projectName, filenameStem) {
  const template = await fetchTemplate();
  if (!template) return false;
  const model = await fetchModel(planText, projectName);
  const warnings = [];
  const bytes = buildMpp(model, template, (w) => warnings.push(w.message));
  for (const message of warnings) console.warn("[mpp]", message);
  download(bytes, `${filenameStem || model.title || "project"}.mpp`);
  return true;
}
