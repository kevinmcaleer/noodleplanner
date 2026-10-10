/**
 * Saved board views (#1552): named filter queries stored in the plan's front
 * matter as a plain YAML list, one tab per entry (#1551).
 *
 *   ---
 *   Views:
 *     - name: Must haves
 *       filter: "label:must -status:Complete"
 *     - name: Doing
 *       filter: "bucket:Doing"
 *   ---
 *
 * List order is tab order. "All Tasks" is implicit and never stored.
 *
 * Pure text in, text out -- no DOM. parseViews() reads the block, and
 * buildPlanTextWithViews() rewrites only the Views: block, leaving every other
 * front-matter key and the plan body untouched.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BoardViews = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SECTION = 'Views';
    const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/;

    /** Quote a scalar for YAML: double quotes, escaping \ and " (and control chars). */
    function quote(value) {
        return '"' + String(value)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t') + '"';
    }

    /** Read a YAML scalar (double-quoted, single-quoted or plain). Null when malformed. */
    function unquote(raw) {
        const s = raw.trim();
        if (s === '') return '';
        if (s[0] === '"') {
            if (s.length < 2 || s[s.length - 1] !== '"') return null;
            let out = '';
            for (let i = 1; i < s.length - 1; i++) {
                const c = s[i];
                if (c === '"') return null;
                if (c !== '\\') { out += c; continue; }
                const n = s[++i];
                if (n === 'n') out += '\n';
                else if (n === 'r') out += '\r';
                else if (n === 't') out += '\t';
                else if (n === '"' || n === '\\' || n === '/') out += n;
                else return null;
            }
            return out;
        }
        if (s[0] === "'") {
            if (s.length < 2 || s[s.length - 1] !== "'") return null;
            const inner = s.slice(1, -1);
            if (/(^|[^'])'([^']|$)/.test(inner)) return null;
            return inner.replace(/''/g, "'");
        }
        return s.replace(/\s+#.*$/, '').trim();
    }

    function nameKey(name) {
        return String(name).trim().toLowerCase();
    }

    /**
     * Parse the Views: block of `planText`.
     * Returns { views: [{ name, filter }], errors: [string] }. Invalid entries
     * (missing or duplicate name, malformed quoting) are skipped and reported;
     * unknown keys on an entry are ignored. Never throws.
     */
    function parseViews(planText) {
        const result = { views: [], errors: [] };
        const fm = typeof planText === 'string' ? planText.match(FRONT_MATTER) : null;
        if (!fm) return result;

        const lines = fm[1].split(/\r?\n/);
        const start = lines.findIndex((l) => /^Views:\s*$/.test(l));
        if (start < 0) return result;

        const entries = [];
        let current = null;
        for (let i = start + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') continue;
            if (!/^\s/.test(line) && !/^-\s/.test(line)) break; // next top-level key
            const item = line.match(/^\s*-\s+(.*)$/);
            if (item) {
                current = {};
                entries.push(current);
                assign(current, item[1]);
            } else if (current) {
                assign(current, line.trim());
            }
        }

        const seen = new Set();
        entries.forEach((e, idx) => {
            const label = `Views entry ${idx + 1}`;
            if (e.name === undefined || e.name === null || String(e.name).trim() === '') {
                result.errors.push(`${label}: missing name`);
                return;
            }
            if (e.name === false) {
                result.errors.push(`${label}: malformed name`);
                return;
            }
            const name = String(e.name).trim();
            const key = nameKey(name);
            if (seen.has(key)) {
                result.errors.push(`${label}: duplicate name "${name}"`);
                return;
            }
            if (e.filter === false) {
                result.errors.push(`${label}: malformed filter`);
                return;
            }
            seen.add(key);
            result.views.push({ name, filter: (e.filter || '').trim() });
        });
        return result;
    }

    function assign(entry, text) {
        const m = text.match(/^(name|filter)\s*:\s*(.*)$/);
        if (!m) return; // unknown key: ignored
        const v = unquote(m[2]);
        entry[m[1]] = v === null ? false : v; // false marks malformed
    }

    /** Render views as the YAML block text (no trailing newline); '' when empty. */
    function serializeViews(views) {
        const list = (views || []).filter((v) => v && String(v.name || '').trim() !== '');
        if (list.length === 0) return '';
        let out = SECTION + ':\n';
        for (const v of list) {
            out += `  - name: ${quote(String(v.name).trim())}\n`;
            out += `    filter: ${quote(String(v.filter || '').trim())}\n`;
        }
        return out.replace(/\n$/, '');
    }

    /**
     * Return `planText` with its Views: block replaced by `views`, leaving all
     * other front-matter keys and the body untouched. An empty list removes the
     * block; a plan with no front matter gains one only when there are views.
     * Throws on duplicate names so a caller cannot write an unreadable block.
     */
    function buildPlanTextWithViews(planText, views) {
        const keys = new Set();
        for (const v of views || []) {
            const k = nameKey(v.name || '');
            if (!k) throw new Error('View name is required');
            if (keys.has(k)) throw new Error(`Duplicate view name "${v.name}"`);
            keys.add(k);
        }
        const block = serializeViews(views);
        const fm = planText.match(FRONT_MATTER);
        if (!fm) {
            return block ? '---\n' + block + '\n---\n\n' + planText : planText;
        }

        const lines = fm[1].split(/\r?\n/);
        const start = lines.findIndex((l) => /^Views:\s*$/.test(l));
        let kept;
        if (start < 0) {
            kept = lines.slice();
            let insertAt = kept.length;
            while (insertAt > 0 && kept[insertAt - 1].trim() === '') insertAt--;
            kept.splice(insertAt, 0, ...(block ? block.split('\n') : []));
        } else {
            let end = start + 1;
            while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]) || /^-\s/.test(lines[end]))) end++;
            while (end > start + 1 && lines[end - 1].trim() === '') end--;
            kept = lines.slice(0, start).concat(block ? block.split('\n') : [], lines.slice(end));
        }
        const eol = /\r\n/.test(fm[0]) ? '\r\n' : '\n';
        const body = kept.join(eol).replace(/^(\r?\n)+/, '');
        const rebuilt = '---' + eol + body + eol + '---';
        return planText.replace(FRONT_MATTER, () => rebuilt);
    }

    /** Move the view at `index` by `delta` (-1 left, +1 right); returns a new array. */
    function moveView(views, index, delta) {
        const out = views.slice();
        const to = index + delta;
        if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out;
        const [v] = out.splice(index, 1);
        out.splice(to, 0, v);
        return out;
    }

    /** True when `name` is free to use (case-insensitive), optionally ignoring one existing view. */
    function isNameAvailable(views, name, ignoreName) {
        const k = nameKey(name);
        if (!k) return false;
        return !views.some((v) => nameKey(v.name) === k && nameKey(v.name) !== nameKey(ignoreName || ''));
    }

    return { parseViews, serializeViews, buildPlanTextWithViews, moveView, isNameAvailable };
});
