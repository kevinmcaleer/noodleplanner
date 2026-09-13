/**
 * Lossless, structured model of a plan's YAML front matter block.
 *
 * The plan's front matter is not "real" YAML in the strict sense -- it is a
 * hand-rolled, line-oriented dialect (see noodle_core/front_matter_parser.py)
 * that supports comments, blank lines, duplicate keys, and nested lists/maps
 * under a key. This module parses that dialect into an ordered list of rows
 * (one per source line, or one per key + its nested block) and can
 * regenerate the exact original text for any row that was not touched.
 *
 * The guarantee this module exists to provide: editing one key through the
 * structured editor must leave every other line -- including comments,
 * blank lines, and formatting -- byte-identical.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NoodleFrontMatter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // ---- Schema: known keys get a friendly widget; everything else falls
    // back to a generic text/block editor but is never dropped. ----
    const SCHEMA = [
        { key: 'title', label: 'Title', kind: 'text',
          description: 'The project name shown in view headers, exports, and the portfolio.' },
        { key: 'project manager', aliases: ['manager', 'owner'], label: 'Project Manager', kind: 'text',
          description: "The project manager's name, shown in the project header and report slides." },
        { key: 'sponsor', label: 'Sponsor', kind: 'text',
          description: 'Executive sponsor name, shown on report slides.' },
        { key: 'budget', label: 'Budget', kind: 'text',
          description: 'Budget amount (free text), shown on report slides.' },
        { key: 'status', label: 'Status', kind: 'select', options: ['Green', 'Amber', 'Red'],
          description: 'Overall project RAG status, shown as a coloured badge.' },
        { key: 'theme', label: 'Theme', kind: 'select', options: ['light', 'dark', 'system'],
          description: 'UI theme preference for this project.' },
        { key: 'resources', label: 'Resources', kind: 'resource-list',
          description: 'Team members with short names (used as @shortname in tasks) and descriptions.' },
        { key: 'dependencies', label: 'Dependencies', kind: 'dependency-list',
          description: 'Cross-project (programme) dependencies managed by the Portfolio Dependencies view.' },
        { key: 'non-working-days', aliases: ['holidays'], label: 'Non-working Days', kind: 'date-list',
          description: 'Project-wide holidays / non-working days, with optional date ranges.' },
        { key: 'calendar', label: 'Active Calendar', kind: 'calendar-select',
          description: 'Which declared calendar is active for scheduling. Unset (or naming one not declared below) falls back to the implicit Standard (Mon-Fri) calendar.' },
        { key: 'calendars', label: 'Calendars', kind: 'calendar-list',
          description: 'Named calendars: a work week (Mon-Fri) or bracketed shift rotation ([Mon-Fri; Mon-Wed]), optional daily hours, and dated exceptions.' },
        { key: 'labels', label: 'Labels', kind: 'flow-list',
          description: 'Tags used for portfolio grouping and filtering.' },
        { key: 'programme', label: 'Programme', kind: 'text',
          description: 'Programme slug this project belongs to.' },
        { key: 'programme_name', label: 'Programme Name', kind: 'text',
          description: 'Human-readable programme name override (derived from the slug otherwise).' },
    ];

    const SCHEMA_BY_KEY = new Map();
    for (const entry of SCHEMA) {
        SCHEMA_BY_KEY.set(entry.key.toLowerCase(), entry);
        for (const alias of entry.aliases || []) SCHEMA_BY_KEY.set(alias.toLowerCase(), entry);
    }

    function schemaFor(key) {
        return SCHEMA_BY_KEY.get(String(key || '').toLowerCase().trim()) || null;
    }

    // ---- Scalar value decode/encode ----

    function findUnquotedHashComment(rest) {
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === '#' && (i === 0 || /\s/.test(rest[i - 1]))) return i;
        }
        return -1;
    }

    function decodeScalar(rest) {
        if (rest[0] === '"') {
            let i = 1, out = '';
            while (i < rest.length) {
                const c = rest[i];
                if (c === '\\' && i + 1 < rest.length) {
                    const next = rest[i + 1];
                    const map = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
                    out += map[next] !== undefined ? map[next] : next;
                    i += 2;
                    continue;
                }
                if (c === '"') { i++; break; }
                out += c;
                i++;
            }
            const trailing = rest.slice(i);
            return { value: out, quote: '"', comment: trailing || null };
        }
        if (rest[0] === "'") {
            let i = 1, out = '';
            while (i < rest.length) {
                if (rest[i] === "'" && rest[i + 1] === "'") { out += "'"; i += 2; continue; }
                if (rest[i] === "'") { i++; break; }
                out += rest[i];
                i++;
            }
            const trailing = rest.slice(i);
            return { value: out, quote: "'", comment: trailing || null };
        }
        const hashIdx = findUnquotedHashComment(rest);
        if (hashIdx === -1) return { value: rest.replace(/\s+$/, ''), quote: null, comment: null };
        const value = rest.slice(0, hashIdx).replace(/\s+$/, '');
        // Keep the original whitespace between the value and the `#` too,
        // so re-attaching the comment on edit reproduces the exact gap.
        const comment = rest.slice(value.length);
        return { value, quote: null, comment };
    }

    function needsQuoting(value) {
        if (value === '') return false;
        if (/^\s|\s$/.test(value)) return true;
        if (/^[\[\]{}&*!|>'"%@`,]/.test(value)) return true;
        if (/:( |$)/.test(value)) return true;
        if (/ #/.test(value)) return true;
        if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
        if (/^-?\d+(\.\d+)?$/.test(value)) return true;
        if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(value)) return true;
        return false;
    }

    function encodeScalar(value) {
        if (value === '' || value == null) return '';
        const str = String(value);
        if (needsQuoting(str)) {
            return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
        }
        return str;
    }

    // ---- Key/value line splitting ----

    function splitKeyValue(text) {
        let colonIdx = -1;
        for (let k = 0; k < text.length; k++) {
            if (text[k] === ':' && (k === text.length - 1 || text[k + 1] === ' ' || text[k + 1] === '\t')) {
                colonIdx = k;
                break;
            }
        }
        if (colonIdx === -1) return null;
        const rawKey = text.slice(0, colonIdx);
        const key = rawKey.trim();
        if (!key || key.startsWith('#') || key.startsWith('-') || key.startsWith('"') || key.startsWith("'")) return null;
        // A real key never contains another colon itself -- reject stray
        // lines like `:::not-a-key:::` that happen to end in `:`.
        if (key.includes(':')) return null;
        let rest = text.slice(colonIdx + 1).replace(/^[ \t]+/, '');
        if (rest === '') {
            return { rawKey, key: key.toLowerCase(), displayKey: key, hasInlineValue: false, value: '', quote: null, inlineComment: null };
        }
        const decoded = decodeScalar(rest);
        return {
            rawKey, key: key.toLowerCase(), displayKey: key, hasInlineValue: true,
            value: decoded.value, quote: decoded.quote, inlineComment: decoded.comment,
        };
    }

    // ---- Row parsing ----

    function indentOf(text) {
        return (/^(\s*)/.exec(text) || ['', ''])[1].length;
    }

    /**
     * Parse the raw front-matter body (the physical lines strictly between
     * the opening and closing `---` delimiters) into an ordered list of rows.
     *
     * `lines` is an array of `{text, eol}` physical-line objects (the same
     * shape NoodlePlanModel uses), so nothing here needs to reason about
     * \r\n vs \n itself.
     */
    function parseBody(lines) {
        const rows = [];
        let i = 0;
        let nextId = 1;
        while (i < lines.length) {
            const line = lines[i];
            const text = line.text;
            const trimmed = text.trim();

            if (trimmed === '') {
                rows.push({ id: nextId++, kind: 'blank', raw: [line], dirty: false });
                i++;
                continue;
            }

            const indent = indentOf(text);
            if (indent === 0 && trimmed.startsWith('#')) {
                rows.push({ id: nextId++, kind: 'comment', raw: [line], dirty: false });
                i++;
                continue;
            }

            if (indent === 0) {
                const kv = splitKeyValue(text);
                if (kv) {
                    if (kv.hasInlineValue) {
                        rows.push({
                            id: nextId++, kind: 'kv', rawKey: kv.rawKey, displayKey: kv.displayKey,
                            key: kv.key, value: kv.value, quote: kv.quote, inlineComment: kv.inlineComment,
                            raw: [line], dirty: false,
                        });
                        i++;
                        continue;
                    }
                    // Key with no inline value: gather the indented / list
                    // block that belongs to it.
                    const children = [];
                    let j = i + 1;
                    while (j < lines.length) {
                        const t = lines[j].text;
                        if (t.trim() === '') { children.push(lines[j]); j++; continue; }
                        const ind = indentOf(t);
                        const strp = t.trim();
                        if (ind > 0 || strp.startsWith('-')) { children.push(lines[j]); j++; continue; }
                        break;
                    }
                    // Trim trailing blank lines back out of the block so they
                    // read as normal blank-line rows (keeps blank-line
                    // preservation simple and predictable).
                    while (children.length && children[children.length - 1].text.trim() === '') {
                        j--;
                        children.pop();
                    }
                    if (children.length === 0) {
                        // `key:` (or `key: ` with only trailing whitespace)
                        // and nothing follows -- an empty scalar, not a block.
                        rows.push({
                            id: nextId++, kind: 'kv', rawKey: kv.rawKey, displayKey: kv.displayKey,
                            key: kv.key, value: '', quote: null, inlineComment: kv.inlineComment,
                            raw: [line], dirty: false,
                        });
                        i = j;
                        continue;
                    }
                    rows.push({
                        id: nextId++, kind: 'block', rawKey: kv.rawKey, displayKey: kv.displayKey,
                        key: kv.key, headerInlineComment: kv.inlineComment, headerRaw: line,
                        children, dirty: false,
                    });
                    i = j;
                    continue;
                }
            }

            // Anything else (stray indented content, malformed lines) is
            // preserved verbatim and never surfaced as editable -- unknown
            // shapes must never be silently dropped.
            rows.push({ id: nextId++, kind: 'raw', raw: [line], dirty: false });
            i++;
        }
        return rows;
    }

    function countKeys(rows) {
        return rows.filter(r => r.kind === 'kv' || r.kind === 'block').length;
    }

    // ---- Sub-schema list parsers/serialisers ----

    function stripListDash(text) {
        const m = /^(\s*)-\s?(.*)$/.exec(text);
        return m ? m[2] : null;
    }

    const ResourceList = {
        parse(children) {
            const entries = [];
            for (const line of children) {
                const item = stripListDash(line.text);
                if (item == null) continue;
                const m = /^(@?[^:]+):\s*(.*)$/.exec(item);
                if (m) entries.push({ shortName: m[1].trim().replace(/^@/, ''), description: m[2].trim() });
                else entries.push({ shortName: item.trim().replace(/^@/, ''), description: '' });
            }
            return entries;
        },
        serialize(entries) {
            return entries
                .filter(e => e.shortName || e.description)
                .map(e => `- @${e.shortName}: ${e.description}`.replace(/:\s*$/, ':').trimEnd());
        },
    };

    const DependencyList = {
        parse(children) {
            const entries = [];
            let current = null;
            for (const line of children) {
                const stripped = line.text.trim();
                if (!stripped) continue;
                if (stripped.startsWith('-')) {
                    if (current) entries.push(current);
                    current = { from: '', task: '', to_task: '', type: 'FS', lag: 0 };
                    const remainder = stripped.slice(1).trim();
                    const kv = splitKeyValue(remainder);
                    if (kv && kv.key in current) current[kv.key] = kv.key === 'lag' ? (parseInt(kv.value, 10) || 0) : kv.value;
                    continue;
                }
                const kv = splitKeyValue(stripped);
                if (kv && current && kv.key in current) current[kv.key] = kv.key === 'lag' ? (parseInt(kv.value, 10) || 0) : kv.value;
            }
            if (current) entries.push(current);
            return entries;
        },
        serialize(entries) {
            const lines = [];
            for (const e of entries) {
                lines.push(`  - from: ${e.from || ''}`);
                lines.push(`    task: ${e.task || ''}`);
                lines.push(`    to_task: ${e.to_task || ''}`);
                lines.push(`    type: ${e.type || 'FS'}`);
                lines.push(`    lag: ${Number.isFinite(+e.lag) ? +e.lag : 0}`);
            }
            return lines;
        },
    };

    const DateList = {
        parse(children) {
            const entries = [];
            for (const line of children) {
                const item = stripListDash(line.text);
                if (item == null) continue;
                const m = /^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/.exec(item);
                if (m) { entries.push({ name: m[1].trim(), start: m[2], finish: m[3] || '' }); continue; }
                const bare = /^(\d{4}-\d{2}-\d{2})\s*$/.exec(item.trim());
                if (bare) entries.push({ name: '', start: bare[1], finish: '' });
            }
            return entries;
        },
        serialize(entries) {
            return entries
                .filter(e => e.start)
                .map(e => {
                    const range = e.finish ? `${e.start}:${e.finish}` : e.start;
                    return e.name ? `  - ${e.name}: ${range}` : `  - ${range}`;
                });
        },
    };

    // A calendar entry's `hours HH:MM-HH:MM` / `exceptions [...]` suffixes
    // (see noodle_core/calendar_model.py for the authoritative grammar).
    // This only splits the line into its four opaque text fields for
    // editing -- it does not interpret the week pattern or exception dates,
    // which is the scheduling engine's job (static/engine/calendar.js),
    // not this lossless front-matter editor's.
    const CalendarList = {
        parse(children) {
            const entries = [];
            for (const line of children) {
                const item = stripListDash(line.text);
                if (item == null) continue;
                const m = /^([^:]+):\s*(.*)$/.exec(item);
                if (!m) continue;
                let rest = m[2];
                let hours = '';
                const hoursMatch = /\bhours\s+(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})\b/i.exec(rest);
                if (hoursMatch) {
                    hours = hoursMatch[1].replace(/\s+/g, '');
                    rest = rest.slice(0, hoursMatch.index) + rest.slice(hoursMatch.index + hoursMatch[0].length);
                }
                let exceptions = '';
                const exceptionsMatch = /\bexceptions\s*\[([^\]]*)\]/i.exec(rest);
                if (exceptionsMatch) {
                    exceptions = exceptionsMatch[1].trim();
                    rest = rest.slice(0, exceptionsMatch.index) + rest.slice(exceptionsMatch.index + exceptionsMatch[0].length);
                }
                entries.push({ name: m[1].trim(), pattern: rest.trim(), hours, exceptions });
            }
            return entries;
        },
        serialize(entries) {
            return entries
                .filter(e => e.name && e.pattern)
                .map(e => {
                    let line = `- ${e.name}: ${e.pattern}`;
                    if (e.hours) line += ` hours ${e.hours}`;
                    if (e.exceptions) line += ` exceptions [${e.exceptions}]`;
                    return line;
                });
        },
    };

    const FlowList = {
        parse(value) {
            const trimmed = String(value || '').trim();
            const inner = trimmed.replace(/^\[/, '').replace(/\]$/, '');
            if (!inner.trim()) return [];
            return inner.split(',').map(s => s.trim()).filter(Boolean);
        },
        serialize(items) {
            return '[' + items.filter(Boolean).join(', ') + ']';
        },
    };

    const LIST_KINDS = {
        'resource-list': ResourceList,
        'dependency-list': DependencyList,
        'date-list': DateList,
        'calendar-list': CalendarList,
    };

    // ---- Row -> line reconstruction ----

    function buildKvLine(row, eolFallback) {
        const eol = (row.raw && row.raw[0] && row.raw[0].eol) || eolFallback || '\n';
        const key = row.displayKey || row.key;
        const encoded = encodeScalar(row.value);
        // inlineComment already carries its own leading whitespace when it
        // came from a parsed line (see decodeScalar); a freshly-added
        // comment falls back to a plain two-space gap.
        const comment = row.inlineComment ? (/^\s/.test(row.inlineComment) ? row.inlineComment : '  ' + row.inlineComment) : '';
        const body = encoded === '' ? `${key}:` : `${key}: ${encoded}`;
        return { text: body + comment, eol };
    }

    function buildBlockLines(row, eolFallback) {
        const eol = (row.headerRaw && row.headerRaw.eol) || eolFallback || '\n';
        const key = row.displayKey || row.key;
        const headerComment = row.headerInlineComment
            ? (/^\s/.test(row.headerInlineComment) ? row.headerInlineComment : '  ' + row.headerInlineComment)
            : '';
        const headerLine = { text: `${key}:${headerComment}`, eol };
        const childLines = (row.childTexts || []).map(t => ({ text: t, eol }));
        return [headerLine, ...childLines];
    }

    function serializeRows(rows, eolFallback) {
        const out = [];
        for (const row of rows) {
            if (row.removed) continue;
            if (row.kind === 'blank' || row.kind === 'comment' || row.kind === 'raw') {
                out.push(...row.raw);
                continue;
            }
            if (row.kind === 'kv') {
                out.push(row.dirty ? buildKvLine(row, eolFallback) : row.raw[0]);
                continue;
            }
            if (row.kind === 'block') {
                if (!row.dirty) {
                    out.push(row.headerRaw, ...row.children);
                } else {
                    out.push(...buildBlockLines(row, eolFallback));
                }
            }
        }
        return out;
    }

    function bodyText(rows, eolFallback) {
        return serializeRows(rows, eolFallback).map(l => l.text + l.eol).join('');
    }

    // ---- Mutating helpers (operate on a rows array + row objects) ----

    function markDirty(row) {
        row.dirty = true;
        return row;
    }

    function setScalarValue(row, newValue) {
        row.value = String(newValue == null ? '' : newValue);
        markDirty(row);
    }

    function setBlockChildTexts(row, texts) {
        row.childTexts = texts;
        markDirty(row);
    }

    function newKvRow(id, key, value) {
        return { id, kind: 'kv', rawKey: key, displayKey: key, key: key.toLowerCase(), value: String(value || ''),
                  quote: null, inlineComment: null, raw: null, dirty: true };
    }

    function newBlockRow(id, key, childTexts) {
        return { id, kind: 'block', rawKey: key, displayKey: key, key: key.toLowerCase(),
                  headerInlineComment: null, headerRaw: null, children: [], childTexts: childTexts || [], dirty: true };
    }

    function removeRow(rows, id) {
        const idx = rows.findIndex(r => r.id === id);
        if (idx === -1) return false;
        rows.splice(idx, 1);
        return true;
    }

    function moveRow(rows, id, delta) {
        const idx = rows.findIndex(r => r.id === id);
        if (idx === -1) return false;
        const target = idx + delta;
        if (target < 0 || target >= rows.length) return false;
        const [row] = rows.splice(idx, 1);
        rows.splice(target, 0, row);
        return true;
    }

    // ---- Locating the front-matter body inside NoodlePlanModel.leading ----

    /**
     * `leadingLines` is a NoodlePlanModel instance's `.leading` array. Only
     * the portion strictly between the opening and closing `---` lines is
     * front matter; anything after the closing delimiter (blank lines,
     * comments before the first task) is left alone.
     */
    function locate(leadingLines) {
        if (!leadingLines || !leadingLines.length || leadingLines[0].text !== '---') {
            return { present: false, headerIndex: -1, footerIndex: -1 };
        }
        for (let i = 1; i < leadingLines.length; i++) {
            if (leadingLines[i].text === '---') {
                return { present: true, headerIndex: 0, footerIndex: i };
            }
        }
        return { present: false, headerIndex: -1, footerIndex: -1 };
    }

    function parseFromLeading(leadingLines) {
        const loc = locate(leadingLines);
        if (!loc.present) return { present: false, rows: [], loc };
        const bodyLines = leadingLines.slice(loc.headerIndex + 1, loc.footerIndex);
        return { present: true, rows: parseBody(bodyLines), loc };
    }

    /**
     * Splice reconstructed rows back into a NoodlePlanModel's `.leading`
     * array in place. Returns true if it changed anything.
     */
    function applyToLeading(leadingLines, loc, rows) {
        if (!loc.present) return false;
        const eol = leadingLines[loc.headerIndex].eol || '\n';
        const newBody = serializeRows(rows, eol);
        leadingLines.splice(loc.headerIndex + 1, loc.footerIndex - loc.headerIndex - 1, ...newBody);
        return true;
    }

    return {
        SCHEMA,
        schemaFor,
        LIST_KINDS,
        ResourceList,
        DependencyList,
        DateList,
        CalendarList,
        FlowList,
        parseBody,
        serializeRows,
        bodyText,
        countKeys,
        setScalarValue,
        setBlockChildTexts,
        newKvRow,
        newBlockRow,
        removeRow,
        moveRow,
        markDirty,
        encodeScalar,
        decodeScalar,
        needsQuoting,
        locate,
        parseFromLeading,
        applyToLeading,
    };
});
