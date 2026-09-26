// MS Project sync target (issue #842, follow-up from #761).
//
// uploadMSProjectFile() used to do `editor.value = markdown` on every MS
// Project import. The imported markdown (projectToMarkdown() in
// mpp-export.js, or import_from_mpp/import_from_msproject_xml server-side)
// only ever contains a bare `title` + `Resources:` front matter and the
// task tree -- it knows nothing about the rest of the plan. A wholesale
// replace therefore silently discards version, project manager, RAG,
// last_saved, any custom front matter fields, and every back-matter section
// (highlights, budget, benefits, RAID log, comms, lessons learned,
// baseline, whiteboard) -- a more severe version of the "blind overwrite"
// bug #841 fixed for RAID Excel.
//
// This module merges an imported task tree into the *existing* plan shell
// instead of replacing it outright: the current plan's front matter fields
// and every back-matter section survive, updated only where the import
// actually provides something new (currently just `title` and
// `Resources:`).
//
// Per-task field-level diffing (matching renamed/reordered tasks across a
// re-import) is deliberately out of scope here -- there is no stable task
// identity in plan markdown to match on (see #842), and inventing a
// heuristic for it risks silently corrupting the schedule, which is a much
// higher-stakes mistake than getting a RAID row wrong. This module treats
// the imported task tree as a single reviewable unit: it goes in whole, or
// not at all, but never at the cost of the rest of the plan.

// back-matter-markers.js is a classic script, not a module, so it has no
// exports to name: this import only runs it, and it publishes the canonical
// marker list and section-boundary helper on globalThis (already there when
// index.html loaded it as a <script>; in Node tests this import is what
// provides them).
import './back-matter-markers.js';

const { npBackMatterSectionEnd } = globalThis;

// Every back-matter section this module carries across an import, by the
// key extractBackMatterSections() returns it under, in canonical write
// order. This used to be a hand-kept copy of the marker list without the
// parking lot or estimates: a plan whose only back matter was one of those
// lost it on every re-import, since the merge rebuilds the plan from the
// sections it knows. Each section still ends at *any* other marker
// (npBackMatterSectionEnd), so one it does not carry is never swallowed.
const SECTIONS = [
    ['highlights', '---highlights---'],
    ['budget', '---budget---'],
    ['benefits', '---benefits---'],
    ['raidLog', '---raid log---'],
    ['comms', '---comms---'],
    ['lessons', '---lessons learned---'],
    ['baseline', '---baseline---'],
    ['whiteboard', '---whiteboard---'],
    ['parkingLot', '---parking lot---'],
    ['estimates', '---estimates---'],
];
const HIGHLIGHTS_END = '---end-highlights---';

export function splitFrontMatter(text) {
    const match = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/);
    if (!match) {
        return { lines: [], rest: text };
    }
    const body = match[2].split(/\r?\n/);
    const rest = match[4].replace(/^\r?\n/, '');
    return { lines: body, rest };
}

/**
 * Group front matter body lines into key-led blocks: each block starts at a
 * top-level `key:` line and includes any indented/list continuation lines
 * that follow, up to the next top-level key. Preserves source order.
 */
function groupFrontMatterBlocks(lines) {
    const blocks = [];
    let current = null;
    for (const line of lines) {
        const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9 _-]*):(.*)$/);
        if (keyMatch && !/^\s/.test(line)) {
            current = { key: keyMatch[1].trim().toLowerCase(), lines: [line] };
            blocks.push(current);
        } else if (current) {
            current.lines.push(line);
        } else if (line.trim() !== '') {
            // Content before any recognised key -- keep it, keyless.
            blocks.push({ key: null, lines: [line] });
        }
    }
    return blocks;
}

/**
 * Merge imported front matter blocks onto the current plan's front matter:
 * existing keys are replaced in place (source position preserved), new
 * keys from the import are appended at the end. Everything the import
 * doesn't mention -- version, project manager, rag, last_saved, custom
 * fields -- survives untouched.
 */
export function mergeFrontMatter(currentLines, importedLines) {
    const currentBlocks = groupFrontMatterBlocks(currentLines);
    const importedBlocks = groupFrontMatterBlocks(importedLines).filter((b) => b.key);

    const byKey = new Map();
    currentBlocks.forEach((block, idx) => {
        if (block.key) byKey.set(block.key, idx);
    });

    const merged = currentBlocks.slice();
    for (const block of importedBlocks) {
        if (byKey.has(block.key)) {
            merged[byKey.get(block.key)] = block;
        } else {
            merged.push(block);
            byKey.set(block.key, merged.length - 1);
        }
    }

    return merged.flatMap((b) => b.lines);
}

function extractSection(text, startMarker) {
    const idx = text.indexOf(startMarker);
    if (idx === -1) return '';
    const afterStart = idx + startMarker.length;
    const endIdx = npBackMatterSectionEnd(text, afterStart, [startMarker]);
    return text.substring(afterStart, endIdx).replace(/^\r?\n+/, '').replace(/\r?\n+$/, '');
}

/**
 * Pull every back-matter section (highlights, budget, benefits, RAID log,
 * comms, lessons learned, baseline, whiteboard, parking lot, estimates)
 * out of a plan's body text (the part after front matter). Returns each
 * section's raw content plus whether the plan had an explicit
 * ---end-highlights--- marker, so it can be rebuilt faithfully.
 */
export function extractBackMatterSections(bodyText) {
    const sections = {};
    for (const [key, marker] of SECTIONS) sections[key] = extractSection(bodyText, marker);
    sections.hasEndHighlights = bodyText.includes(HIGHLIGHTS_END);
    return sections;
}

/**
 * Strip every back-matter section out of body text, leaving just the task
 * outline (plus a leading blank line or two, trimmed).
 */
export function stripBackMatterSections(bodyText) {
    const earliestIdx = npBackMatterSectionEnd(bodyText, 0);
    let base = earliestIdx < bodyText.length ? bodyText.substring(0, earliestIdx) : bodyText;
    base = base.replace(/\r?\n+$/, '');
    const lines = base.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '---') lines.pop();
    return lines.join('\n').replace(/\r?\n+$/, '');
}

function appendSection(text, marker, content) {
    if (!content) return text;
    return text.replace(/\n+$/, '') + '\n\n' + marker + '\n' + content;
}

/**
 * Assemble full plan text from its parts: front matter lines, a task body,
 * and the back-matter sections extracted by extractBackMatterSections.
 * Shared by the whole-tree merge (mergeImportedTasks) and the per-task diff
 * apply flow (script.js's applyTaskSyncReview), which supplies its own
 * task body built by msproject-task-diff.js's applyTaskDiff instead of
 * taking the import's task tree wholesale.
 */
export function assemblePlanText(frontMatterLines, taskBody, sections) {
    let result = '---\n' + frontMatterLines.join('\n') + '\n---\n' + taskBody;

    for (const [key, marker] of SECTIONS) {
        result = appendSection(result, marker, sections[key]);
        if (key === 'highlights' && sections.highlights && sections.hasEndHighlights) {
            result = result.replace(/\n+$/, '') + '\n\n' + HIGHLIGHTS_END;
        }
    }

    return result;
}

/**
 * Merge a freshly-imported task tree into the current plan: the import's
 * front matter fields (title, Resources) are applied on top of the
 * current front matter (everything else -- version, project manager, rag,
 * last_saved, custom fields -- is preserved), the import's task outline
 * replaces the current one, and every back-matter section (see SECTIONS
 * above) is carried over unchanged.
 */
export function mergeImportedTasks(currentPlanText, importedMarkdown) {
    const current = splitFrontMatter(currentPlanText);
    const imported = splitFrontMatter(importedMarkdown);

    const mergedFrontMatterLines = mergeFrontMatter(current.lines, imported.lines);
    const sections = extractBackMatterSections(current.rest);
    const importedTaskBody = stripBackMatterSections(imported.rest);

    return assemblePlanText(mergedFrontMatterLines, importedTaskBody, sections);
}

/**
 * Insert or update a single front-matter key in plan text. Duplicated from
 * raid-sync.js's identical helper rather than cross-importing between two
 * otherwise-independent, independently-testable sync target modules -- see
 * setLastSavedInFrontMatter in script.js for the pattern both follow.
 */
export function upsertFrontMatterField(text, key, value) {
    const fmMatch = text.match(/^(---\n)([\s\S]*?)(\n---)/);
    const linePattern = new RegExp(`^${key}:.*$`, 'm');
    if (fmMatch) {
        let body = fmMatch[2];
        if (linePattern.test(body)) {
            body = body.replace(linePattern, `${key}: ${value}`);
        } else {
            body += `\n${key}: ${value}`;
        }
        return fmMatch[1] + body + fmMatch[3] + text.slice(fmMatch[0].length);
    }
    return `---\n${key}: ${value}\n---\n${text}`;
}

const MSP_SYNC_STORAGE_PREFIX = 'noodleplanner:msp-sync:';

/**
 * The task outline text as it stood at the last successful MS Project sync,
 * scoped per project -- the "base" msproject-task-diff.js's diffTaskOutline
 * needs for a three-way diff (so it can tell a genuine conflict from a
 * one-sided change, and stop a deliberately-removed task from being
 * resurrected by the next reimport). It's an implementation cache, not plan
 * content, so it lives in localStorage rather than the markdown -- same
 * reasoning as raid-sync.js's getRaidSyncState/setRaidSyncState, which this
 * mirrors.
 */
export function getMspSyncState(projectId) {
    try {
        const raw = localStorage.getItem(MSP_SYNC_STORAGE_PREFIX + (projectId || 'default'));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Failed to read MS Project sync state:', error);
        return null;
    }
}

export function setMspSyncState(projectId, state) {
    try {
        localStorage.setItem(MSP_SYNC_STORAGE_PREFIX + (projectId || 'default'), JSON.stringify(state));
    } catch (error) {
        console.warn('Failed to persist MS Project sync state:', error);
    }
}

export function clearMspSyncState(projectId) {
    try {
        localStorage.removeItem(MSP_SYNC_STORAGE_PREFIX + (projectId || 'default'));
    } catch (error) {
        console.warn('Failed to clear MS Project sync state:', error);
    }
}
