// RAID <-> Excel sync framework (issue #761).
//
// "Upload RAID Excel" used to be a one-shot, one-way overwrite:
// `raidItems = data.items`, discarding whatever was in the plan. This module
// replaces that with a real sync: it remembers the file a project is linked
// to, diffs the freshly-read workbook against a three-way base (last synced
// snapshot / current plan / external file), and produces a reviewable
// accept/reject change list instead of silently overwriting anything.
//
// This is a local-file target only. SharePoint-backed targets need Graph
// file access (#767, still open) and are out of scope here; the design
// mirrors what the issue asks for so a SharePoint target can be added later
// as another registered target rather than a rewrite.

const SYNC_STORAGE_PREFIX = 'noodleplanner:raid-sync:';

/**
 * Diff kinds for a single RAID item, in fixed severity/display order.
 */
export const DIFF_KIND = {
    CONFLICT: 'conflict',
    ADDED: 'added',
    UPDATED: 'updated',
    REMOVED: 'removed',
};

function itemsById(items) {
    const map = new Map();
    (items || []).forEach((item) => map.set(item.id, item));
    return map;
}

function itemsEqual(a, b) {
    if (!a || !b) return a === b;
    const fields = [
        'type', 'title', 'description', 'raised_by', 'owner',
        'mitigation_actions', 'impact', 'likelihood', 'score', 'status',
    ];
    return fields.every((f) => String(a[f] ?? '') === String(b[f] ?? ''));
}

/**
 * Three-way diff of RAID items: what changed in the external (Excel) file
 * relative to the last-synced snapshot, compared against what's in the plan
 * right now (`localItems`).
 *
 * `baseItems` is the snapshot recorded at the last successful sync, or an
 * empty array for a first-ever sync (every external item and every local
 * item is then just "new to this pairing", not a conflict).
 *
 * Returns entries in a stable order: conflicts first, then added, updated,
 * removed — each carries enough of the local/external/base row for a
 * side-by-side review UI to render without re-deriving anything.
 */
export function diffRaidSync(localItems, externalItems, baseItems) {
    const local = itemsById(localItems);
    const external = itemsById(externalItems);
    const base = itemsById(baseItems);

    const allIds = new Set([...local.keys(), ...external.keys(), ...base.keys()]);
    const entries = [];

    for (const id of allIds) {
        const l = local.get(id) || null;
        const e = external.get(id) || null;
        const b = base.get(id) || null;

        if (l && e && itemsEqual(l, e)) continue; // unchanged, nothing to review

        if (!l && e) {
            // Present externally, absent locally.
            if (b) {
                // It was known at the last sync and is now gone from the
                // plan — the plan deliberately removed it. Don't resurrect
                // it silently just because the workbook still has it.
                continue;
            }
            entries.push({ id, kind: DIFF_KIND.ADDED, local: l, external: e, base: b });
            continue;
        }

        if (l && !e) {
            // Present locally, absent externally.
            if (b) {
                // It existed at last sync and is now gone from the workbook
                // — the external file removed it.
                entries.push({ id, kind: DIFF_KIND.REMOVED, local: l, external: e, base: b });
            }
            // Else: a row added locally since the last sync, and the
            // workbook simply doesn't know about it yet — nothing to
            // review, it'll go out on the next write-back.
            continue;
        }

        // Present on both sides but different.
        const localChanged = !b || !itemsEqual(l, b);
        const externalChanged = !b || !itemsEqual(e, b);

        if (localChanged && externalChanged) {
            entries.push({ id, kind: DIFF_KIND.CONFLICT, local: l, external: e, base: b });
        } else if (externalChanged) {
            entries.push({ id, kind: DIFF_KIND.UPDATED, local: l, external: e, base: b });
        }
        // Else: only the local side changed since last sync — the workbook
        // is stale, not the plan. Nothing to import; it'll be corrected on
        // write-back.
    }

    const order = { [DIFF_KIND.CONFLICT]: 0, [DIFF_KIND.ADDED]: 1, [DIFF_KIND.UPDATED]: 2, [DIFF_KIND.REMOVED]: 3 };
    entries.sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id);
    return entries;
}

/**
 * Apply a set of accepted diff entries onto `localItems`, given the user's
 * per-entry choice. Returns a new items array; does not mutate the input.
 *
 * `choices` maps entry id -> 'accept' | 'reject' | 'keep-mine' | 'keep-theirs'.
 * Conflicts default to 'keep-mine' if no choice is recorded, so an
 * unreviewed conflict never silently takes the external value.
 */
export function applyRaidSyncDiff(localItems, entries, choices) {
    const result = (localItems || []).slice();
    const byId = new Map(result.map((item, idx) => [item.id, idx]));

    for (const entry of entries) {
        const choice = choices[entry.id];

        if (entry.kind === DIFF_KIND.CONFLICT) {
            if (choice === 'keep-theirs') {
                const idx = byId.get(entry.id);
                if (idx !== undefined) result[idx] = entry.external;
            }
            continue; // 'keep-mine' (default) — leave local value untouched
        }

        if (choice === 'reject') continue; // explicit opt-out, default for REMOVED

        if (entry.kind === DIFF_KIND.ADDED) {
            if (choice === 'accept') result.push(entry.external);
        } else if (entry.kind === DIFF_KIND.UPDATED) {
            if (choice !== 'reject') {
                const idx = byId.get(entry.id);
                if (idx !== undefined) result[idx] = entry.external;
            }
        } else if (entry.kind === DIFF_KIND.REMOVED) {
            if (choice === 'accept') {
                const idx = byId.get(entry.id);
                if (idx !== undefined) result.splice(idx, 1);
            }
        }
    }
    return result;
}

/**
 * Default per-entry choice, applied when the user hasn't touched a row in
 * the review list: additions and updates from the workbook are accepted by
 * default (that's the point of syncing), removals require an explicit
 * accept, and conflicts require an explicit side.
 */
export function defaultRaidSyncChoice(kind) {
    if (kind === DIFF_KIND.ADDED || kind === DIFF_KIND.UPDATED) return 'accept';
    if (kind === DIFF_KIND.REMOVED) return 'reject';
    return 'keep-mine';
}

function storageKey(projectId) {
    return SYNC_STORAGE_PREFIX + (projectId || 'default');
}

/**
 * Remembered sync state for a project's RAID Excel target: the linked
 * filename and the row snapshot as of the last successful sync (the "base"
 * for the next three-way diff). Snapshot lives in localStorage — it's an
 * implementation cache, not plan content; the human-visible link (filename +
 * timestamp) is written to the plan's front matter separately.
 */
export function getRaidSyncState(projectId) {
    try {
        const raw = localStorage.getItem(storageKey(projectId));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Failed to read RAID sync state:', error);
        return null;
    }
}

export function setRaidSyncState(projectId, state) {
    try {
        localStorage.setItem(storageKey(projectId), JSON.stringify(state));
    } catch (error) {
        console.warn('Failed to persist RAID sync state:', error);
    }
}

export function clearRaidSyncState(projectId) {
    try {
        localStorage.removeItem(storageKey(projectId));
    } catch (error) {
        console.warn('Failed to clear RAID sync state:', error);
    }
}

/**
 * Insert or update a single front-matter key in plan text, matching the
 * `last_saved` field's established pattern (see setLastSavedInFrontMatter
 * in script.js). Creates a front matter block if none exists.
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

export function getFrontMatterField(text, key) {
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fieldMatch = match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return fieldMatch ? fieldMatch[1].trim() : null;
}
