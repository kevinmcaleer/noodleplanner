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
// baseline) -- a more severe version of the "blind overwrite" bug #841
// fixed for RAID Excel.
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

const SECTION_MARKERS = [
    '---highlights---',
    '---budget---',
    '---benefits---',
    '---raid log---',
    '---comms---',
    '---lessons learned---',
    '---baseline---',
];
const HIGHLIGHTS_END = '---end-highlights---';

function splitFrontMatter(text) {
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

function extractSection(text, startMarker, endMarkers) {
    const idx = text.indexOf(startMarker);
    if (idx === -1) return '';
    const afterStart = idx + startMarker.length;
    let endIdx = text.length;
    for (const marker of endMarkers) {
        const markerIdx = text.indexOf(marker, afterStart);
        if (markerIdx !== -1 && markerIdx < endIdx) endIdx = markerIdx;
    }
    return text.substring(afterStart, endIdx).replace(/^\r?\n+/, '').replace(/\r?\n+$/, '');
}

/**
 * Pull every back-matter section (highlights, budget, benefits, RAID log,
 * comms, lessons learned, baseline) out of a plan's body text (the part
 * after front matter). Returns each section's raw content plus whether the
 * plan had an explicit ---end-highlights--- marker, so it can be rebuilt
 * faithfully.
 */
export function extractBackMatterSections(bodyText) {
    const [highlightsStart, budgetStart, benefitsStart, raidStart, commsStart, lessonsStart, baselineStart] = SECTION_MARKERS;
    // extractSection is called with HIGHLIGHTS_START separately below since
    // it has its own end marker precedence.
    const highlights = extractSection(bodyText, highlightsStart,
        [HIGHLIGHTS_END, budgetStart, benefitsStart, raidStart, commsStart, lessonsStart, baselineStart]);
    const hasEndHighlights = bodyText.includes(HIGHLIGHTS_END);
    const budget = extractSection(bodyText, budgetStart,
        [benefitsStart, raidStart, commsStart, lessonsStart, baselineStart]);
    const benefits = extractSection(bodyText, benefitsStart,
        [raidStart, commsStart, lessonsStart, baselineStart]);
    const raidLog = extractSection(bodyText, raidStart, [commsStart, lessonsStart, baselineStart]);
    const comms = extractSection(bodyText, commsStart, [lessonsStart, baselineStart]);
    const lessons = extractSection(bodyText, lessonsStart, [baselineStart]);
    const baseline = bodyText.indexOf(baselineStart) !== -1
        ? bodyText.substring(bodyText.indexOf(baselineStart) + baselineStart.length).replace(/^\r?\n+/, '')
        : '';

    return { highlights, hasEndHighlights, budget, benefits, raidLog, comms, lessons, baseline };
}

/**
 * Strip every back-matter section out of body text, leaving just the task
 * outline (plus a leading blank line or two, trimmed).
 */
export function stripBackMatterSections(bodyText) {
    let earliestIdx = bodyText.length;
    for (const marker of SECTION_MARKERS) {
        const idx = bodyText.indexOf(marker);
        if (idx !== -1 && idx < earliestIdx) earliestIdx = idx;
    }
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
 * Merge a freshly-imported task tree into the current plan: the import's
 * front matter fields (title, Resources) are applied on top of the
 * current front matter (everything else -- version, project manager, rag,
 * last_saved, custom fields -- is preserved), the import's task outline
 * replaces the current one, and every back-matter section (highlights,
 * budget, benefits, RAID log, comms, lessons learned, baseline) is carried
 * over unchanged.
 */
export function mergeImportedTasks(currentPlanText, importedMarkdown) {
    const current = splitFrontMatter(currentPlanText);
    const imported = splitFrontMatter(importedMarkdown);

    const mergedFrontMatterLines = mergeFrontMatter(current.lines, imported.lines);
    const sections = extractBackMatterSections(current.rest);
    const importedTaskBody = stripBackMatterSections(imported.rest);

    let result = '---\n' + mergedFrontMatterLines.join('\n') + '\n---\n' + importedTaskBody;

    result = appendSection(result, '---highlights---', sections.highlights);
    if (sections.highlights && sections.hasEndHighlights) {
        result = result.replace(/\n+$/, '') + '\n\n' + '---end-highlights---';
    }
    result = appendSection(result, '---budget---', sections.budget);
    result = appendSection(result, '---benefits---', sections.benefits);
    result = appendSection(result, '---raid log---', sections.raidLog);
    result = appendSection(result, '---comms---', sections.comms);
    result = appendSection(result, '---lessons learned---', sections.lessons);
    result = appendSection(result, '---baseline---', sections.baseline);

    return result;
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

/**
 * A short, human-readable summary of what a merge will change, for a
 * confirm-before-apply prompt: which back-matter sections survive, and
 * whether the front matter picked up new fields from the import.
 */
export function summarizeMerge(currentPlanText, importedMarkdown) {
    const current = splitFrontMatter(currentPlanText);
    const sections = extractBackMatterSections(current.rest);
    const preserved = [];
    if (sections.highlights) preserved.push('highlights');
    if (sections.budget) preserved.push('budget');
    if (sections.benefits) preserved.push('benefits');
    if (sections.raidLog) preserved.push('RAID log');
    if (sections.comms) preserved.push('communications plan');
    if (sections.lessons) preserved.push('lessons learned');
    if (sections.baseline) preserved.push('baseline');
    return { preservedSections: preserved };
}
