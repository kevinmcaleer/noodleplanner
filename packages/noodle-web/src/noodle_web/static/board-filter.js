/**
 * Board filter (#1542): a GitHub-Projects-style query for the board.
 *
 *   login                      keyword, matches the task name / comment
 *   label:must                 qualifier (label, status, bucket, resource, phase)
 *   -status:Complete           a leading "-" excludes
 *   label:must,should          comma-separated values are OR
 *   phase:"Phase 1"            quotes keep a value with spaces together
 *
 * Terms are separated by spaces and combine with AND.
 *
 * This file is pure (parse / match / suggest) apart from BoardFilterField at
 * the bottom, which binds the text input and its suggestion list.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BoardFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const KEYS = ['label', 'status', 'bucket', 'resource', 'phase'];
    const KEY_ALIASES = { labels: 'label', resources: 'resource', phases: 'phase', buckets: 'bucket' };
    const KEY_HINTS = {
        label: 'Cards with a label',
        status: 'Not started, In progress or Complete',
        bucket: 'Cards in a bucket',
        resource: 'Cards assigned to someone',
        phase: 'Cards in a phase',
    };
    const STATUSES = [
        { id: 'not_started', label: 'Not started' },
        { id: 'in_progress', label: 'In progress' },
        { id: 'complete', label: 'Complete' },
    ];
    const STATUS_ALIASES = {
        notstarted: 'not_started', todo: 'not_started',
        inprogress: 'in_progress', started: 'in_progress',
        complete: 'complete', completed: 'complete', done: 'complete',
    };

    const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[\s_-]+/g, ' ');

    /** Split into whitespace-separated tokens, keeping "quoted runs" together. */
    function tokenize(query) {
        const tokens = [];
        const text = String(query || '');
        let i = 0;
        while (i < text.length) {
            if (/\s/.test(text[i])) { i++; continue; }
            const start = i;
            let inQuote = false;
            while (i < text.length && (inQuote || !/\s/.test(text[i]))) {
                if (text[i] === '"') inQuote = !inQuote;
                i++;
            }
            tokens.push({ raw: text.slice(start, i), start, end: i });
        }
        return tokens;
    }

    const unquote = (s) => s.replace(/"/g, '');

    /** Split "a,b,"c d"" on commas outside quotes. */
    function splitValues(s) {
        const out = [];
        let cur = '';
        let inQuote = false;
        for (const ch of s) {
            if (ch === '"') { inQuote = !inQuote; continue; }
            if (ch === ',' && !inQuote) { out.push(cur); cur = ''; continue; }
            cur += ch;
        }
        out.push(cur);
        return out.map(v => v.trim()).filter(Boolean);
    }

    /**
     * @returns {{terms: object[], errors: {raw:string, message:string}[]}}
     * A term is {negate, key (null for a keyword), values[], raw}.
     */
    function parse(query) {
        const terms = [];
        const errors = [];
        for (const tok of tokenize(query)) {
            let body = tok.raw;
            let negate = false;
            if (body.startsWith('-') && body.length > 1) { negate = true; body = body.slice(1); }
            const colon = body.indexOf(':');
            const quoteAt = body.indexOf('"');
            if (colon > 0 && (quoteAt === -1 || colon < quoteAt)) {
                const rawKey = body.slice(0, colon).toLowerCase();
                const key = KEY_ALIASES[rawKey] || rawKey;
                if (!KEYS.includes(key)) {
                    errors.push({ raw: tok.raw, message: `Unknown filter "${body.slice(0, colon)}"` });
                    continue;
                }
                const values = splitValues(body.slice(colon + 1));
                if (!values.length) continue; // "label:" still being typed
                if (key === 'status') {
                    const bad = values.find(v => !STATUS_ALIASES[norm(v).replace(/ /g, '')]);
                    if (bad) {
                        errors.push({ raw: tok.raw, message: `Unknown status "${bad}"` });
                        continue;
                    }
                }
                terms.push({ negate, key, values, raw: tok.raw });
            } else {
                const word = unquote(body).trim();
                if (word) terms.push({ negate, key: null, values: [word], raw: tok.raw });
            }
        }
        return { terms, errors };
    }

    const fieldValues = {
        label: (t) => (t.labelsArray || []).map(norm),
        resource: (t) => [
            ...(t.resourceShortnames || []),
            ...(t.resourcesArray || []),
        ].map(v => norm(String(v).replace(/^@/, ''))),
        bucket: (t) => [norm(t.bucket) || 'no bucket', ...(norm(t.bucket) ? [] : ['none'])],
        phase: (t) => [norm(t.phase)],
        status: (t) => [t.progressStatus],
    };

    function termMatches(task, term) {
        if (term.key === null) {
            const hay = norm(`${task.name || ''} ${task.comment || ''}`);
            return hay.includes(norm(term.values[0]));
        }
        const have = fieldValues[term.key](task);
        return term.values.some(v => {
            if (term.key === 'status') return have.includes(STATUS_ALIASES[norm(v).replace(/ /g, '')]);
            return have.includes(norm(String(v).replace(/^@/, '')));
        });
    }

    /** Does the task satisfy every term of a parsed query? */
    function matches(task, parsed) {
        return parsed.terms.every(term => termMatches(task, term) !== term.negate);
    }

    // ---- suggestions -----------------------------------------------------

    const quoteIfNeeded = (v) => (/[\s,"]/.test(v) ? `"${v}"` : v);

    /**
     * Suggestions for the token under the caret.
     * vocab: {label: string[], status: string[], bucket, resource, phase} where an
     * entry is a string or {value, description}.
     * @returns {{from:number, to:number, items:{label,insert,kind,description}[]}}
     */
    function suggest(query, caret, vocab) {
        const text = String(query || '');
        const pos = caret == null ? text.length : caret;
        const tok = tokenize(text).find(t => t.start <= pos && pos <= t.end);
        const from = tok ? tok.start : pos;
        const to = tok ? tok.end : pos;
        const raw = tok ? tok.raw : '';
        const dash = raw.startsWith('-') ? '-' : '';
        const body = raw.slice(dash.length);
        const colon = body.indexOf(':');

        if (colon === -1) {
            const typed = body.toLowerCase();
            const items = KEYS.filter(k => k.startsWith(typed)).map(k => ({
                label: `${k}:`, insert: `${dash}${k}:`, kind: 'key', description: KEY_HINTS[k],
            }));
            // A bare word that already completes a key offers nothing new.
            return { from, to, items: typed === '' || items.length ? items : [] };
        }

        const rawKey = body.slice(0, colon).toLowerCase();
        const key = KEY_ALIASES[rawKey] || rawKey;
        if (!KEYS.includes(key)) return { from, to, items: [] };

        const valuePart = body.slice(colon + 1);
        const done = splitValues(valuePart);
        const endsComma = valuePart.endsWith(',');
        const partial = endsComma ? '' : (done[done.length - 1] || '');
        const chosen = (endsComma ? done : done.slice(0, -1)).map(norm);
        let cut = -1;
        let q = false;
        for (let i = 0; i < valuePart.length; i++) {
            if (valuePart[i] === '"') q = !q;
            else if (valuePart[i] === ',' && !q) cut = i;
        }
        const prefix = dash + body.slice(0, colon + 1) + valuePart.slice(0, cut + 1);

        const entries = (vocab && vocab[key]) || [];
        const seen = new Set();
        const items = [];
        for (const e of entries) {
            const value = typeof e === 'string' ? e : e.value;
            const n = norm(value);
            if (!value || seen.has(n) || chosen.includes(n)) continue;
            seen.add(n);
            if (!n.startsWith(norm(partial.replace(/^@/, ''))) && !n.includes(norm(partial.replace(/^@/, '')))) continue;
            items.push({
                label: value,
                insert: prefix + quoteIfNeeded(value),
                kind: 'value',
                description: typeof e === 'string' ? '' : (e.description || ''),
            });
        }
        // Prefix matches first, then contains.
        const p = norm(partial.replace(/^@/, ''));
        items.sort((a, b) => (norm(b.label).startsWith(p) - norm(a.label).startsWith(p)));
        return { from, to, items };
    }

    /** Build the vocab the suggestions draw on from a list of parsed tasks. */
    function buildVocab(tasks, extra) {
        const sets = { label: new Map(), bucket: new Map(), resource: new Map(), phase: new Map() };
        const add = (k, value, description) => {
            if (value && !sets[k].has(norm(value))) sets[k].set(norm(value), { value, description: description || '' });
        };
        (extra.labels || []).forEach(l => add('label', l));
        (extra.buckets || []).forEach(b => add('bucket', b));
        (extra.phases || []).forEach(p => add('phase', p));
        tasks.forEach(t => {
            (t.labelsArray || []).forEach(l => add('label', l));
            if (t.bucket && t.bucket.trim()) add('bucket', t.bucket.trim());
            if (t.phase) add('phase', t.phase);
            (t.resourceShortnames || []).forEach((short, i) => {
                const full = (t.resourcesArray || [])[i];
                add('resource', short, full && norm(full) !== norm(short) ? full : '');
            });
        });
        const list = (k) => Array.from(sets[k].values());
        return {
            label: list('label'),
            status: STATUSES.map(s => s.label),
            bucket: list('bucket'),
            resource: list('resource'),
            phase: list('phase'),
        };
    }

    // ---- the text field --------------------------------------------------

    /**
     * Binds an <input> to a suggestion list.
     * opts: {input, list, status, clear, getVocab(), onChange(parsed, query)}
     */
    function BoardFilterField(opts) {
        const { input, list } = opts;
        let items = [];
        let active = -1;
        let range = { from: 0, to: 0 };
        let uid = 0;

        const close = () => {
            list.hidden = true;
            list.innerHTML = '';
            items = [];
            active = -1;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        };

        const setActive = (i) => {
            active = i;
            Array.from(list.children).forEach((li, idx) => {
                const on = idx === i;
                li.setAttribute('aria-selected', on ? 'true' : 'false');
                li.classList.toggle('is-active', on);
                if (on) {
                    input.setAttribute('aria-activedescendant', li.id);
                    li.scrollIntoView?.({ block: 'nearest' });
                }
            });
        };

        const accept = (i) => {
            const item = items[i];
            if (!item) return;
            const v = input.value;
            const needsSpace = item.kind === 'value' ? ' ' : '';
            // After a value, move on to the next term; after a key, keep typing.
            const tail = v.slice(range.to);
            const next = v.slice(0, range.from) + item.insert + (tail.startsWith(' ') ? '' : needsSpace) + tail;
            input.value = next;
            const caret = range.from + item.insert.length + (needsSpace && !tail.startsWith(' ') ? 1 : 0);
            input.setSelectionRange(caret, caret);
            changed();
            refresh();
        };

        const refresh = () => {
            const res = suggest(input.value, input.selectionStart, opts.getVocab());
            items = res.items;
            range = res;
            list.innerHTML = '';
            if (!items.length || document.activeElement !== input) { close(); return; }
            items.forEach((it, idx) => {
                const li = document.createElement('li');
                li.id = `${list.id}-opt-${idx}-${uid++}`;
                li.setAttribute('role', 'option');
                li.className = `board-filter-option board-filter-option-${it.kind}`;
                const name = document.createElement('span');
                name.className = 'board-filter-option-label';
                name.textContent = it.label;
                li.appendChild(name);
                if (it.description) {
                    const d = document.createElement('span');
                    d.className = 'board-filter-option-desc';
                    d.textContent = it.description;
                    li.appendChild(d);
                }
                // mousedown, not click: the input must not lose focus first.
                li.addEventListener('mousedown', (e) => { e.preventDefault(); accept(idx); });
                list.appendChild(li);
            });
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            setActive(-1);
        };

        const changed = (silent) => {
            const parsed = parse(input.value);
            if (opts.clear) opts.clear.hidden = !input.value;
            input.classList.toggle('has-errors', parsed.errors.length > 0);
            input.setAttribute('aria-invalid', parsed.errors.length ? 'true' : 'false');
            if (!silent && opts.onChange) opts.onChange(parsed, input.value);
        };

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', list.id);
        input.autocomplete = 'off';
        input.spellcheck = false;

        input.addEventListener('input', () => { changed(); refresh(); });
        input.addEventListener('focus', refresh);
        input.addEventListener('click', refresh);
        input.addEventListener('blur', () => setTimeout(close, 100));
        input.addEventListener('keydown', (e) => {
            const open = !list.hidden && items.length;
            if (e.key === 'ArrowDown') {
                if (!open) { refresh(); return; }
                e.preventDefault();
                setActive((active + 1) % items.length);
            } else if (e.key === 'ArrowUp' && open) {
                e.preventDefault();
                setActive((active - 1 + items.length) % items.length);
            } else if ((e.key === 'Enter' || e.key === 'Tab') && open && active >= 0) {
                e.preventDefault();
                accept(active);
            } else if (e.key === 'Escape') {
                if (open) { e.preventDefault(); e.stopPropagation(); close(); }
                else if (input.value) { e.preventDefault(); input.value = ''; changed(); }
            }
        });
        // Caret moves without typing change which token is suggested.
        input.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') refresh();
        });
        if (opts.clear) {
            opts.clear.addEventListener('click', () => {
                input.value = '';
                changed();
                input.focus();
            });
        }
        changed(true);
        // set(): load a stored query; silent skips onChange (the caller is mid-render).
        return { refresh, close, set(v, silent) { input.value = v || ''; changed(silent); } };
    }

    return {
        KEYS, STATUSES, parse, matches, suggest, buildVocab, tokenize, BoardFilterField,
    };
});
