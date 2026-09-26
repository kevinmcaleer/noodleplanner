/**
 * back-matter-markers.js -- the one canonical list of back-matter section
 * markers, and the "where does this section end" rule every reader and
 * writer of a back-matter section shares.
 *
 * A plan ends with back-matter sections, each opened by a marker line
 * (`---raid log---`, `---whiteboard---`, `---estimates---` ...). Any code
 * that pulls one section out of the plan text has to stop at the *next*
 * marker, whichever it is -- not just the ones canonically written after
 * it (noodle-core's #978) -- so it has to know every marker there is. That
 * list used to be hand-copied into each reader and writer, and the copies
 * drifted as sections were added: `---parking lot---` (#1019) and
 * `---estimates---` (#1053) never reached most of them. A section a copy
 * did not know was read as the tail of whatever preceded it -- estimates
 * rows became phantom whiteboard notes and RAID items, and the next write
 * of that section deleted the estimates outright. Declaring the list here,
 * once, is what keeps the next new section from repeating that.
 *
 * Mirrors format_converter.py's ALL_SECTION_MARKERS (a test holds the two
 * lists together). Adding a section means adding its marker here and there.
 *
 * Loaded three ways, so it is written as a classic script rather than an
 * ES module:
 *  - as a classic <script> ahead of state.js in index.html and
 *    collab_join.html, publishing the names below as globals for every
 *    classic script (script.js, whiteboard-structure.js ...);
 *  - by a side-effect `import './back-matter-markers.js'` from the ES
 *    modules (msproject-sync.js, collab-backmatter-ops.js), which then read
 *    the same globals -- a module cannot import names from a classic script,
 *    and a classic script cannot import from a module;
 *  - by require() in Node tests, and from estimating.js's CommonJS branch.
 */
(function (root) {
    'use strict';

    // Canonical write order: highlights, budget, benefits, raid log, comms,
    // lessons learned, baseline, whiteboard, parking lot, estimates. Nothing
    // enforces that order in hand- or AI-edited text, so never rely on it to
    // find where a section ends -- use npBackMatterSectionEnd() below.
    const NP_BACK_MATTER_MARKERS = Object.freeze([
        '---highlights---',
        '---end-highlights---',
        '---budget---',
        '---benefits---',
        '---raid log---',
        '---comms---',
        '---lessons learned---',
        '---baseline---',
        '---whiteboard---',
        '---parking lot---',
        '---estimates---',
    ]);

    /** True when `line`, trimmed, is exactly one of the markers above. */
    function npIsBackMatterMarker(line) {
        return NP_BACK_MATTER_MARKERS.includes(String(line == null ? '' : line).trim());
    }

    /**
     * Index of `marker` in `text`, at or after `fromIdx`, where it is the
     * entire trimmed content of its own line; -1 if there is none.
     *
     * A bare `text.indexOf(marker)` also matches a marker quoted inside an
     * ordinary line -- a whiteboard note or a RAID description that happens
     * to contain "---estimates---" -- and would cut the section short there.
     * Same rule as collab-backmatter-ops.js's indexOfMarkerLine and
     * plan-model.js's whole-line BACK_MATTER regex.
     */
    function npBackMatterMarkerIndex(text, marker, fromIdx) {
        const src = String(text == null ? '' : text);
        let searchFrom = Math.max(0, fromIdx || 0);
        while (searchFrom <= src.length) {
            const idx = src.indexOf(marker, searchFrom);
            if (idx === -1) return -1;
            const lineStart = src.lastIndexOf('\n', idx - 1) + 1;
            let lineEnd = src.indexOf('\n', idx + marker.length);
            if (lineEnd === -1) lineEnd = src.length;
            if (src.slice(lineStart, lineEnd).trim() === marker) return idx;
            searchFrom = idx + marker.length;
        }
        return -1;
    }

    /**
     * Where the section whose body starts at `fromIdx` ends: the index of
     * the earliest marker line at or after `fromIdx`, or `text.length` if
     * none follows. Markers listed in `exclude` are not boundaries -- a
     * reader passes its own start marker there, as the per-section copies
     * this replaced always did, so a duplicated section is read whole
     * rather than cut at its own repeat.
     *
     * With `fromIdx` 0 this is where the back matter begins at all, i.e.
     * the end of the task outline.
     */
    function npBackMatterSectionEnd(text, fromIdx, exclude) {
        const src = String(text == null ? '' : text);
        let endIdx = src.length;
        for (const marker of NP_BACK_MATTER_MARKERS) {
            if (exclude && exclude.includes(marker)) continue;
            const idx = npBackMatterMarkerIndex(src, marker, fromIdx);
            if (idx !== -1 && idx < endIdx) endIdx = idx;
        }
        return endIdx;
    }

    const api = {
        NP_BACK_MATTER_MARKERS,
        npIsBackMatterMarker,
        npBackMatterMarkerIndex,
        npBackMatterSectionEnd,
    };
    Object.assign(root, api);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
