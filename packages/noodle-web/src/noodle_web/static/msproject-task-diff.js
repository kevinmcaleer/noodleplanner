// Per-task diff for MS Project re-imports (#842, follow-up from #761/#852).
//
// #852 fixed the severe bug (import wiping front matter and back-matter
// sections) but still replaces the whole task tree as one unit -- there is
// no persistent task ID in plan markdown to match rows on across a
// re-import. Rather than invent one (a markdown format change), this
// implements the alternative the user chose: match tasks by name within
// their position in the outline hierarchy.
//
// Known, accepted limitation of that choice: a renamed task, or one moved
// to a different parent, has a different (name, ancestor-path) identity and
// so shows as "removed" + "added" rather than "updated". Reordering among
// siblings under the same parent is fine; a name or parent change is not
// distinguishable from a delete-and-recreate.

const LEVEL_SEP = ' › ';

/**
 * Extract a stable-ish name for identity matching: strip every inline
 * token NoodlePlanner's task grammar recognises (star/star-lag dependency
 * shorthand, quoted note, [depends ...], [repeats ...], {bucket}, @resource,
 * ~effort, !/!!/!!! priority, #label, $product, Nd/Nh duration, NN% percent,
 * YYYY-MM-DD date) so what's left is just the task's own name. Mirrors
 * task-tokenizer.js's token grammar -- duplicated rather than imported
 * because that file is a plain global script (loaded for syntax
 * highlighting), not an ES module, and this needs to run standalone and be
 * unit-testable with `node --test`.
 */
export function extractTaskName(line) {
    let working = line.replace(/^\s*/, '');
    working = working.replace(/^\*(?:[+-]\d+[dwmy])?\s*/, '');
    working = working.replace(/["“][^"”]*["”]/g, ' ');
    working = working.replace(/\[depends(?::\s*|\s+)[^\]]+\]/gi, ' ');
    working = working.replace(/\[repeats\s+[^\]]+\]/gi, ' ');
    working = working.replace(/\{[^}]+\}/g, ' ');
    working = working.replace(/@\w+/g, ' ');
    working = working.replace(/~\d+(?:\.\d+)?[hd](?:\/\d+(?:\.\d+)?[hd])?/g, ' ');
    working = working.replace(/(?<![\w!])(!!!|!!|!)(?![\w!"'{])/g, ' ');
    working = working.replace(/#\w+/g, ' ');
    working = working.replace(/[/^]?\$[A-Za-z_][A-Za-z0-9_-]*/g, ' ');
    working = working.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
    working = working.replace(/(?<!\w)\d+%(?!\w)/g, ' ');
    working = working.replace(/\b\d+[dmwy]\b/g, ' ');
    return working.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a task outline (front matter and back-matter sections already
 * stripped) into a flat array of nodes, each carrying:
 *  - raw: the original line, unmodified
 *  - indent: raw leading-whitespace character count (matches
 *    scheduling_engine.py's `len(line) - len(line.lstrip())`)
 *  - name: identity name via extractTaskName
 *  - parentKey: the key of this node's parent, '' at top level
 *  - key: this node's own identity key -- parentKey + name, with a
 *    `#2`/`#3`/... suffix disambiguating same-named siblings under the
 *    same parent so duplicate task names don't collide onto one entry
 *  - lineIndex: index into bodyText.split('\n')
 */
export function parseTaskOutline(bodyText) {
    const lines = bodyText.split('\n');
    const stack = []; // { indent, key }
    const childOccurrences = new Map(); // parentKey -> Map(name -> count)
    const result = [];

    lines.forEach((raw, lineIndex) => {
        if (!raw.trim()) return;
        const indent = raw.length - raw.replace(/^\s*/, '').length;
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        const parentKey = stack.length ? stack[stack.length - 1].key : '';

        const name = extractTaskName(raw);
        if (!childOccurrences.has(parentKey)) childOccurrences.set(parentKey, new Map());
        const counts = childOccurrences.get(parentKey);
        const occurrence = (counts.get(name) || 0) + 1;
        counts.set(name, occurrence);
        const segment = occurrence > 1 ? `${name}#${occurrence}` : name;
        const key = parentKey ? parentKey + LEVEL_SEP + segment : segment;

        result.push({ raw, indent, name, parentKey, key, lineIndex });
        stack.push({ indent, key });
    });

    return result;
}

/**
 * Every descendant of `node` in `outline` -- all subsequent nodes whose key
 * starts with `node.key + LEVEL_SEP`. Used to cascade a removal to a
 * summary task's children rather than orphaning them.
 */
function descendantsOf(node, outline) {
    const prefix = node.key + LEVEL_SEP;
    return outline.filter((n) => n.key.startsWith(prefix));
}

/**
 * Diff a local task outline against a freshly-imported one, matched by
 * (name, ancestor-path) identity. Returns entries in a stable order --
 * conflicts first (most consequential), then removed, then updated, then
 * added -- each carrying enough of the local/imported/base node for a
 * review UI to render.
 *
 * A removed *summary* task's children are not each listed separately (that
 * would turn one real decision -- "this phase is gone" -- into a wall of
 * redundant rows); only "removal roots" (nodes whose parent still exists,
 * or has no parent) get their own entry, carrying `descendantCount` so a
 * review UI can warn how many child lines would be cascade-removed with it.
 *
 * `baseBody` is optional: the task outline as it stood at the last
 * successful sync (see msp-sync-state.js), enabling a proper three-way
 * diff instead of a plain two-way comparison:
 *  - Omitted entirely: every local/imported difference is reported as-is
 *    (removed/updated/added), same as a first-ever sync -- there's no
 *    history to reason about who changed what.
 *  - Provided: a task present locally but not in the import is only
 *    flagged "removed" if it existed at the last sync (otherwise it's a
 *    fresh local addition the import simply doesn't know about yet, not a
 *    deletion to review). A task present in the import but not locally is
 *    only flagged "added" if it did NOT exist at the last sync (otherwise
 *    the plan deliberately removed it, and re-importing shouldn't
 *    resurrect it). A task changed on both sides since the last sync is a
 *    "conflict" instead of an "updated" -- changed on the import side only
 *    is still "updated"; changed on the plan side only means the import is
 *    the stale one, so there's nothing to review.
 */
export function diffTaskOutline(localBody, importedBody, baseBody) {
    const local = parseTaskOutline(localBody);
    const imported = parseTaskOutline(importedBody);
    const importedByKey = new Map(imported.map((n) => [n.key, n]));
    const localByKey = new Map(local.map((n) => [n.key, n]));

    const hasBase = baseBody !== undefined;
    const base = hasBase ? parseTaskOutline(baseBody) : [];
    const baseByKey = new Map(base.map((n) => [n.key, n]));

    const removedKeys = new Set();
    for (const node of local) {
        if (importedByKey.has(node.key)) continue;
        if (hasBase && !baseByKey.has(node.key)) continue; // fresh local addition -- import just doesn't know yet
        removedKeys.add(node.key);
    }

    const entries = [];
    const matchedKeys = new Set();

    for (const node of local) {
        matchedKeys.add(node.key);
        if (removedKeys.has(node.key)) {
            if (removedKeys.has(node.parentKey)) continue; // cascaded, not a root
            entries.push({
                key: node.key,
                kind: 'removed',
                local: node,
                imported: null,
                descendantCount: descendantsOf(node, local).length,
            });
            continue;
        }
        const other = importedByKey.get(node.key);
        if (!other) continue; // fresh local addition, nothing to compare yet
        if (node.raw.trim() === other.raw.trim()) continue; // unchanged

        if (!hasBase) {
            entries.push({ key: node.key, kind: 'updated', local: node, imported: other });
            continue;
        }
        const baseNode = baseByKey.get(node.key) || null;
        const localChanged = !baseNode || baseNode.raw.trim() !== node.raw.trim();
        const importedChanged = !baseNode || baseNode.raw.trim() !== other.raw.trim();
        if (localChanged && importedChanged) {
            entries.push({ key: node.key, kind: 'conflict', local: node, imported: other, base: baseNode });
        } else if (importedChanged) {
            entries.push({ key: node.key, kind: 'updated', local: node, imported: other });
        }
        // else: only the local side changed since the last sync -- the
        // import is stale, not the plan. Nothing to review.
    }

    for (const node of imported) {
        if (matchedKeys.has(node.key)) continue;
        if (hasBase && baseByKey.has(node.key)) continue; // plan deliberately removed it -- don't resurrect
        entries.push({ key: node.key, kind: 'added', local: null, imported: node });
    }

    const order = { conflict: 0, removed: 1, updated: 2, added: 3 };
    entries.sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
    return { entries, local, imported, localByKey };
}

export function defaultTaskSyncChoice(kind) {
    if (kind === 'updated' || kind === 'added') return 'accept';
    if (kind === 'conflict') return 'keep-mine'; // never silently take the external value on an unreviewed conflict
    return 'reject'; // removed defaults to reject -- cascading deletes need an explicit opt-in
}

/**
 * Detect the outline's own per-level indent step, from the first node that
 * has a parent (its indent minus its parent's indent). Falls back to 2
 * spaces -- NoodlePlanner's own convention (see mpp-export.js) -- when the
 * outline is flat or empty.
 */
function detectIndentStep(outline) {
    const byKey = new Map(outline.map((n) => [n.key, n]));
    for (const node of outline) {
        if (!node.parentKey) continue;
        const parent = byKey.get(node.parentKey);
        if (parent && node.indent > parent.indent) return node.indent - parent.indent;
    }
    return 2;
}

/**
 * Apply accepted diff entries onto the local task outline text. `choices`
 * maps entry key -> 'accept' | 'reject'. Returns the new body text.
 *
 * - Removals cascade to every descendant of an accepted removal root,
 *   computed against original line indexes so accepting several removals
 *   at once is unambiguous regardless of order.
 * - Updates replace a single line in place, re-indented to the local
 *   document's own indentation (only the logical depth was required to
 *   match, not the literal character count -- the imported document may
 *   use a different indent width entirely).
 * - Additions are inserted in the imported document's original order, so a
 *   newly-added parent always lands before its newly-added children; a
 *   child accepted without its parent auto-brings the parent along too
 *   (silently expanding acceptance up the chain) rather than inserting an
 *   orphaned child with no preceding parent line, which would corrupt the
 *   outline.
 */
export function applyTaskDiff(localBody, diffResult, choices) {
    const { entries, local, imported, localByKey } = diffResult;
    // '' .split('\n') is [''], a phantom empty line that would otherwise
    // survive as a stray leading blank line once tasks are inserted into
    // what was an empty outline (first sync, or every task removed).
    const originalLines = localBody === '' ? [] : localBody.split('\n');

    const addedByKey = new Map(entries.filter((e) => e.kind === 'added').map((e) => [e.key, e]));
    const effectiveAdds = new Set();
    for (const entry of entries) {
        if (entry.kind !== 'added' || choices[entry.key] !== 'accept') continue;
        effectiveAdds.add(entry.key);
        let parentKey = entry.imported.parentKey;
        while (parentKey && addedByKey.has(parentKey) && !effectiveAdds.has(parentKey)) {
            effectiveAdds.add(parentKey);
            parentKey = addedByKey.get(parentKey).imported.parentKey;
        }
    }

    const removedRoots = entries.filter((e) => e.kind === 'removed' && choices[e.key] === 'accept');
    const toRemoveLineIndexes = new Set();
    for (const entry of removedRoots) {
        toRemoveLineIndexes.add(entry.local.lineIndex);
        for (const d of descendantsOf(entry.local, local)) toRemoveLineIndexes.add(d.lineIndex);
    }

    // Post-removal line array, plus a map from every surviving local task's
    // key to its new index in that array -- avoids any ambiguity from
    // duplicate line text, unlike searching for a line by its content.
    const lines = [];
    const keyToIndex = new Map();
    originalLines.forEach((line, originalIndex) => {
        if (toRemoveLineIndexes.has(originalIndex)) return;
        const newIndex = lines.length;
        lines.push(line);
        const node = local.find((n) => n.lineIndex === originalIndex);
        if (node) keyToIndex.set(node.key, newIndex);
    });

    for (const entry of entries) {
        const takesImportedContent = (entry.kind === 'updated' && choices[entry.key] === 'accept') ||
            (entry.kind === 'conflict' && choices[entry.key] === 'keep-theirs');
        if (!takesImportedContent) continue; // conflict with no choice, or 'keep-mine', leaves the local line untouched
        const idx = keyToIndex.get(entry.key);
        if (idx === undefined) continue;
        lines[idx] = ' '.repeat(entry.local.indent) + entry.imported.raw.replace(/^\s*/, '');
    }

    // Tracks, for every key that exists locally (pre-existing, or already
    // inserted this pass), the line index of the last line in its subtree
    // -- i.e. where the next child of that key should be inserted after.
    // Seeded from every surviving node, propagated up so a parent's own
    // entry reflects its deepest surviving child, not just its own line.
    const subtreeEnd = new Map();
    const bumpAncestors = (parentKey, atIndex) => {
        let key = parentKey;
        while (key) {
            const current = subtreeEnd.get(key);
            if (current === undefined || atIndex > current) subtreeEnd.set(key, atIndex);
            const node = localByKey.get(key) || (addedByKey.get(key) || {}).imported;
            key = node ? node.parentKey : '';
        }
    };
    for (const [key, idx] of keyToIndex) {
        subtreeEnd.set(key, idx);
        const node = localByKey.get(key);
        if (node) bumpAncestors(node.parentKey, idx);
    }
    const depthOf = (key) => {
        let depth = 0;
        let node = localByKey.get(key) || (addedByKey.get(key) || {}).imported;
        while (node && node.parentKey) {
            depth += 1;
            node = localByKey.get(node.parentKey) || (addedByKey.get(node.parentKey) || {}).imported;
        }
        return depth;
    };

    const indentStep = detectIndentStep(imported);
    // Imported order (already the outline's natural top-to-bottom order via
    // parseTaskOutline) guarantees a parent is always processed before its
    // children, since a child's key is only ever added to effectiveAdds
    // alongside or after its parent's.
    for (const node of imported) {
        if (!effectiveAdds.has(node.key) || keyToIndex.has(node.key)) continue;
        const parentEnd = node.parentKey ? subtreeEnd.get(node.parentKey) : lines.length - 1;
        const insertAt = (parentEnd === undefined ? lines.length - 1 : parentEnd) + 1;

        const newLine = ' '.repeat(depthOf(node.key) * indentStep) + node.raw.replace(/^\s*/, '');
        lines.splice(insertAt, 0, newLine);

        for (const [key, idx] of subtreeEnd) {
            if (idx >= insertAt) subtreeEnd.set(key, idx + 1);
        }
        keyToIndex.set(node.key, insertAt);
        subtreeEnd.set(node.key, insertAt);
        bumpAncestors(node.parentKey, insertAt);
    }

    return lines.join('\n');
}
