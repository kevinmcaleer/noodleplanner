/**
 * collab-merge.js -- a line-based three-way merge for the planning-session
 * joiner (#1347).
 *
 * A joiner edits the whiteboard locally and sends the host the whole plan
 * text (`plan_text_replace`). The host is the single writer and rejects a
 * replacement made against an out-of-date revision, which is right -- it
 * must never let one participant silently overwrite another -- but it
 * means two people working on the board at once keep bouncing each other.
 * The joiner uses this to rebase its unconfirmed edit onto the plan the host
 * has since broadcast, and only gives up when both sides changed the same
 * lines.
 *
 * The plan is line-oriented -- a task per line, a whiteboard note per table
 * row -- so lines are the right unit: moving two different notes changes two
 * different rows, and merges cleanly. Two insertions at the same point (two
 * people adding a note at once, both appending a row) are kept, theirs
 * first, rather than reported as a conflict.
 *
 * `merge3(base, ours, theirs)` returns the merged text, or null on a real
 * conflict. A classic script exposing `NoodleCollabMerge`, and a CommonJS
 * module for tests/test_collab_merge.mjs.
 */
(function (global) {
    'use strict';

    /**
     * The edits that turn `a` into `b`, as hunks over `a`'s lines:
     * `{ start, end, lines }` replaces a[start, end) with `lines`. An
     * insertion has start === end. Common prefix and suffix are trimmed
     * before the LCS, so a typical edit to a long plan costs next to nothing.
     */
    function diffHunks(a, b) {
        let prefix = 0;
        while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
        let suffix = 0;
        while (suffix < a.length - prefix && suffix < b.length - prefix &&
               a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

        const aMid = a.slice(prefix, a.length - suffix);
        const bMid = b.slice(prefix, b.length - suffix);
        const n = aMid.length;
        const m = bMid.length;
        if (n === 0 && m === 0) return [];
        if (n === 0 || m === 0) return [{ start: prefix, end: prefix + n, lines: bMid }];

        // LCS lengths of the suffixes, row-major (n + 1) x (m + 1).
        const width = m + 1;
        const table = new Uint32Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                table[i * width + j] = aMid[i] === bMid[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
            }
        }

        const hunks = [];
        let current = null;
        let i = 0;
        let j = 0;
        const open = () => {
            if (!current) current = { start: prefix + i, end: prefix + i, lines: [] };
        };
        const close = () => {
            if (current) { hunks.push(current); current = null; }
        };
        while (i < n || j < m) {
            if (i < n && j < m && aMid[i] === bMid[j]) {
                close();
                i++; j++;
            } else if (j < m && (i === n || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
                open();
                current.lines.push(bMid[j]);
                j++;
            } else {
                open();
                i++;
                current.end = prefix + i;
            }
        }
        close();
        return hunks;
    }

    function sameHunk(x, y) {
        return x.start === y.start && x.end === y.end &&
            x.lines.length === y.lines.length && x.lines.every((line, k) => line === y.lines[k]);
    }

    /** Whether two hunks touch the same base lines. Adjacent ranges do not;
     * an insertion only clashes with a range it lands strictly inside. */
    function overlaps(x, y) {
        const xInsert = x.start === x.end;
        const yInsert = y.start === y.end;
        if (xInsert && yInsert) return false; // same-point insertions are both kept
        if (xInsert) return y.start < x.start && x.start < y.end;
        if (yInsert) return x.start < y.start && y.start < x.end;
        return Math.max(x.start, y.start) < Math.min(x.end, y.end);
    }

    function merge3(base, ours, theirs) {
        base = String(base == null ? '' : base);
        ours = String(ours == null ? '' : ours);
        theirs = String(theirs == null ? '' : theirs);
        if (ours === theirs || theirs === base) return ours;
        if (ours === base) return theirs;

        const baseLines = base.split('\n');
        const oursHunks = diffHunks(baseLines, ours.split('\n'));
        const theirsHunks = diffHunks(baseLines, theirs.split('\n'));

        const all = [];
        for (const hunk of theirsHunks) all.push({ ...hunk, side: 0 });
        for (const hunk of oursHunks) {
            if (theirsHunks.some(other => sameHunk(other, hunk))) continue; // both made it
            if (theirsHunks.some(other => overlaps(other, hunk))) return null;
            all.push({ ...hunk, side: 1 });
        }
        // Base order; at one position insertions go before a replacement,
        // and theirs before ours.
        all.sort((x, y) => (x.start - y.start) ||
            ((x.end - x.start) - (y.end - y.start)) || (x.side - y.side));

        const out = [];
        let cursor = 0;
        for (const hunk of all) {
            while (cursor < hunk.start) out.push(baseLines[cursor++]);
            out.push(...hunk.lines);
            cursor = Math.max(cursor, hunk.end);
        }
        while (cursor < baseLines.length) out.push(baseLines[cursor++]);
        return out.join('\n');
    }

    const api = { merge3, diffHunks };
    global.NoodleCollabMerge = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
