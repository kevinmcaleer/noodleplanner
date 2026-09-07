/* Shared task-line grammar for parsing, scheduling and syntax highlighting.
 *
 * This is the *one* place a task line is taken apart (issues #748, #793).
 * Three consumers read a line and they all read it through here:
 *
 *   - the editor's syntax highlighter wants source spans  -> tokenize()
 *   - the editor's forms want the values in those spans   -> metadata()
 *   - the scheduler wants the fields noodle_core produces -> extractMetadata()
 *
 * The constructs themselves are defined once, in FRAGMENTS below, and every
 * pattern is composed from those fragments. Where the highlighter is
 * deliberately stricter than the scheduler (a trailing comma should not be
 * painted as part of a resource) the difference is a named modifier on the
 * shared fragment, not a second grammar.
 *
 * extractMetadata() is a port of noodle_core/metadata.py's extract_metadata
 * and has to stay field-for-field identical to it: tests/test_engine_tokeniser.mjs
 * compares the two over the whole conformance corpus.
 *
 * The file is a classic script (browser, and importScripts in a worker) that
 * also exports itself for CommonJS/ESM consumers, so the browser engine and
 * the Node tests share this implementation instead of copying it.
 */
(function (root, factory) {
    const api = factory();
    root.TaskLineTokenizer = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // ---------------------------------------------------------------
    // The grammar: one definition per construct, as pattern sources.
    // ---------------------------------------------------------------
    const FRAGMENTS = Object.freeze({
        date: String.raw`(\d{4}-\d{2}-\d{2})`,
        duration: String.raw`\b(\d+)([dwmy])\b`,
        // A duration inside an effort token (~2d/5d) is effort, not duration.
        notEffort: String.raw`(?<!~)(?<![~/])`,
        percent: String.raw`(\d{1,3})%`,
        legacyPercent: String.raw`\bp(\d{1,3})\b`,
        legacyDuration: String.raw`:p(\d+)d`,
        effort: String.raw`~(\d+(?:\.\d+)?)(h|d)(?:\/(\d+(?:\.\d+)?)(h|d))?`,
        priority: String.raw`(!!!|!!|!)`,
        // The scheduler reads a resource as a whitespace-delimited token, so
        // "@kev," keeps its comma exactly as noodle_core does; the editor
        // paints the word only (resourceStrict) so punctuation stays plain.
        resource: String.raw`@(\S+)`,
        resourceStrict: String.raw`@\w+`,
        label: String.raw`#([^@%#!\s]+)`,
        labelStrict: String.raw`#\w+`,
        qualityRole: String.raw`^(.+?):(P|R|A)$`,
        product: String.raw`([\/^])?\$([A-Za-z_][A-Za-z0-9_-]*)`,
        dependsBlock: String.raw`\[depends\s*:?\s*([^\]]*)\]`,
        // The highlighter only paints a block that actually names something.
        dependsBlockFilled: String.raw`\[depends(?::\s*|\s+)[^\]]+\]`,
        repeats: String.raw`\[repeats\s+([^\]]+)\]`,
        bucket: String.raw`\{([^}]+)\}`,
        levelled: String.raw`\[levelled\s+@?(\S+)\s+(\d{4}-\d{2}-\d{2})\s*\]`,
        doubleQuoted: String.raw`"([^"]+)"`,
        singleQuoted: String.raw`'([^']+)'`,
        // The editor also paints smart quotes and the empty pair, so typing an
        // opening quote does not repaint the rest of the line.
        quotedSpan: String.raw`["\u201c][^"\u201d]*["\u201d]`,
        starLag: String.raw`([+\-]\d+[dwmy])`,
        depType: String.raw`(FS|SS|FF|SF)`,
    });

    const F = FRAGMENTS;
    const re = (source, flags) => new RegExp(source, flags);

    /** Days in one duration token; the same table as noodle_core/date_math. */
    const DURATION_UNIT_DAYS = Object.freeze({ d: 1, w: 7, m: 30, y: 365 });

    // ---------------------------------------------------------------
    // The span lexer: source ranges for the highlighter and the editor.
    // ---------------------------------------------------------------
    const patterns = [
        ['comment', re(F.quotedSpan, 'g')],
        ['dependency', re(F.dependsBlockFilled, 'gi')],
        ['recurrence', re(F.repeats, 'gi')],
        ['bucket', re(F.bucket, 'g')],
    ];
    const tokenPattern = re([
        F.effort,
        String.raw`(?<![\w!])${F.priority}(?![\w!"'{])`,
        F.resourceStrict,
        F.labelStrict,
        F.product,
        `${F.notEffort}${F.duration}`,
        String.raw`(?<!\w)${F.percent}(?!\w)`,
        String.raw`\b${F.date}\b`,
    ].join('|'), 'g');
    const effortToken = re(`^${F.effort}$`);
    const starLagToken = re(`^${F.starLag}\\b`);

    function addToken(tokens, line, type, start, end) {
        tokens.push({ type, start, end, text: line.slice(start, end) });
    }

    function tokenize(line) {
        const tokens = [];
        const protectedRanges = [];
        const trimmedStart = line.search(/\S/);
        if (trimmedStart !== -1 && line[trimmedStart] === '*') {
            addToken(tokens, line, 'star', trimmedStart, trimmedStart + 1);
            const lag = starLagToken.exec(line.slice(trimmedStart + 1).trimStart());
            if (lag) {
                const lagStart = line.indexOf(lag[0], trimmedStart + 1);
                addToken(tokens, line, 'star-lag', lagStart, lagStart + lag[0].length);
            }
        }

        for (const [type, pattern] of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(line))) {
                addToken(tokens, line, type, match.index, match.index + match[0].length);
                protectedRanges.push([match.index, match.index + match[0].length]);
            }
        }

        tokenPattern.lastIndex = 0;
        let match;
        while ((match = tokenPattern.exec(line))) {
            const start = match.index;
            if (protectedRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd) ||
                tokens.some(token => start >= token.start && start < token.end)) continue;
            const text = match[0];
            const type = text[0] === '~' ? 'effort'
                : text[0] === '!' ? 'priority'
                : text[0] === '@' ? 'resource'
                : text[0] === '#' ? 'label'
                : text.includes('$') ? 'product'
                : text.endsWith('%') ? 'percent'
                : /^\d{4}-/.test(text) ? 'date'
                : 'duration';
            addToken(tokens, line, type, start, start + text.length);
        }
        return tokens.sort((a, b) => a.start - b.start || b.end - a.end);
    }

    function metadata(line) {
        const tokens = tokenize(line);
        const values = {
            name: '', duration: '', startDate: '', finishDate: '', percent: '',
            resources: [], labels: [], comment: '', priority: 'Low', bucket: '',
            dependencies: [], recurrence: '', product_type: undefined, deliverable: undefined,
            effortCompleted: '', effortCompletedUnit: 'h', effortRemaining: '',
            effortRemainingUnit: 'h', effortTotal: '', effortTotalUnit: 'h',
            hasStar: false, starLagLead: ''
        };
        const removable = new Array(line.length).fill(false);
        const dates = [];
        for (const token of tokens) {
            if (token.type !== 'star' && token.type !== 'star-lag') {
                for (let i = token.start; i < token.end; i++) removable[i] = true;
            }
            const text = token.text;
            if (token.type === 'star') values.hasStar = true;
            else if (token.type === 'star-lag') values.starLagLead = text;
            else if (token.type === 'comment' && !values.comment) values.comment = text.slice(1, -1);
            else if (token.type === 'bucket' && !values.bucket) values.bucket = text.slice(1, -1).trim();
            else if (token.type === 'priority') values.priority = text === '!!!' ? 'Urgent' : text === '!!' ? 'Important' : 'Medium';
            else if (token.type === 'recurrence' && !values.recurrence) values.recurrence = text.replace(/^\[repeats\s+|\]$/gi, '').trim().toLowerCase();
            else if (token.type === 'dependency') {
                const content = text.replace(/^\[depends(?::\s*|\s+)|\]$/gi, '');
                values.dependencies.push(...content.split(',').map(value => value.trim()).filter(Boolean));
            } else if (token.type === 'resource') values.resources.push(text.slice(1));
            else if (token.type === 'label') values.labels.push(text.slice(1));
            else if (token.type === 'duration') values.duration = text.slice(0, -1);
            else if (token.type === 'percent') values.percent = text.slice(0, -1);
            else if (token.type === 'date') dates.push(text);
            else if (token.type === 'product') {
                values.product_type = text[0] === '/' ? 'group' : text[0] === '^' ? 'external' : 'internal';
                values.deliverable = text.replace(/^[/^]?\$/, '');
            } else if (token.type === 'effort' && !values.effortTotal) {
                const effort = effortToken.exec(text);
                if (effort[3] !== undefined) {
                    values.effortCompleted = effort[1]; values.effortCompletedUnit = effort[2];
                    values.effortTotal = effort[3]; values.effortTotalUnit = effort[4];
                    values.effortRemaining = String(parseFloat(effort[3]) - parseFloat(effort[1]));
                    values.effortRemainingUnit = effort[4];
                } else {
                    values.effortCompleted = '0'; values.effortCompletedUnit = effort[2];
                    values.effortTotal = effort[1]; values.effortTotalUnit = effort[2];
                    values.effortRemaining = effort[1]; values.effortRemainingUnit = effort[2];
                }
            }
        }
        if (values.effortTotal) {
            const completed = parseFloat(values.effortCompleted) * (values.effortCompletedUnit === 'd' ? 8 : 1);
            const total = parseFloat(values.effortTotal) * (values.effortTotalUnit === 'd' ? 8 : 1);
            values.percent = String(Math.max(0, Math.min(100, Math.round(completed / total * 100))));
        }
        values.startDate = dates[0] || '';
        values.finishDate = dates[1] || '';
        values.name = line.split('').filter((_, index) => !removable[index]).join('')
            .replace(/^\s*\*(?:\s*[+\-]\d+[dwmy])?/, '').replace(/\s+/g, ' ').trim();
        return { tokens, values };
    }

    // ---------------------------------------------------------------
    // The semantic reading (noodle_core/metadata.py's extract_metadata):
    // the same fragments, with the anchors and lookarounds Python uses.
    // ---------------------------------------------------------------
    const TOKEN_SPLIT = /(?<!\\)\s+/;
    const QUALITY_ROLE = re(F.qualityRole, 'i');
    const DEPENDS_BLOCK = re(String.raw`\[depends[^\]]*\]`, 'gi');
    const DELIVERABLE = re(F.product);
    const LABEL = re(F.label, 'g');
    const BRACKET_DEP = re(F.dependsBlock, 'i');
    const LAG_LEAD = re(String.raw`^(.+?)\s+${F.starLag}$`);
    const DEP_TYPE = re(String.raw`^(.+?):${F.depType}$`, 'i');
    const RECURRENCE = re(F.repeats, 'i');
    const BUCKET = re(F.bucket);
    const PRIORITY = re(String.raw`(?<!\w)${F.priority}(?!["'])`);
    const BANG_COMMENT = re(String.raw`!(?:${F.doubleQuoted}|${F.singleQuoted})`);
    const DQ_COMMENT = re(F.doubleQuoted);
    const SQ_COMMENT = re(F.singleQuoted);
    const EFFORT = re(F.effort);
    const PERCENT = re(F.percent);
    const LEGACY_PERCENT = re(F.legacyPercent);
    const LEVELLED = re(F.levelled, 'i');
    const DATE = re(F.date);
    const DURATION = re(`${F.notEffort}${F.duration}`);
    const LEGACY_DURATION = re(F.legacyDuration);
    // The description is whatever precedes the first metadata token, so this
    // one lists the openers of every construct above. It is metadata.py's
    // _DESCRIPTION: change what counts as a token and task names change.
    const DESCRIPTION = /\*?(.*?)([/^]?\$[A-Za-z]|@|#|!|"|\{|\[|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwmy]|\d+%|~\d|$)/;
    const PERCENT_TOKEN = /\s*\b\d{1,3}%/g;

    /** parse_recurrence: "weekly mon,wed" and friends. */
    function parseRecurrence(text) {
        const s = String(text || '').trim().toLowerCase();
        const result = { raw: s };

        if (s === 'daily') {
            result.frequency = 'daily';
        } else if (s === 'yearly') {
            result.frequency = 'yearly';
        } else if (s.startsWith('weekly')) {
            result.frequency = 'weekly';
            const days = s.slice('weekly'.length).trim();
            result.days = days ? days.split(',').map(d => d.trim()).filter(Boolean) : [];
        } else if (s.startsWith('monthly')) {
            result.frequency = 'monthly';
            const rest = s.slice('monthly'.length).trim();
            const ordinals = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
            const match = /(\d+(?:st|nd|rd|th))\s+(\w+)/.exec(rest);
            if (match) {
                result.week_of_month = ordinals[match[1]] === undefined ? 1 : ordinals[match[1]];
                result.day_of_week = match[2];
            }
        } else {
            result.frequency = s;
        }
        return result;
    }

    /** Python's round(): halves go to the nearest even number. */
    function bankersRound(value) {
        const floor = Math.floor(value);
        const diff = value - floor;
        if (diff > 0.5) return floor + 1;
        if (diff < 0.5) return floor;
        return floor % 2 === 0 ? floor : floor + 1;
    }

    /**
     * Every field metadata.extract_metadata pulls out of one task line.
     *
     * @param {string} taskStr the line, including any `*` prefix
     * @param {string} [taskName] the name the tree builder assigned
     * @returns {object} the same keys the Python returns, omitted the same
     *   way, with the duration as `duration_days` (Python holds a timedelta).
     */
    function extractMetadata(taskStr, taskName = null) {
        const line = String(taskStr === null || taskStr === undefined ? '' : taskStr);
        const meta = {};

        // --- resources and quality roles ---
        const tokens = line.split(TOKEN_SPLIT);
        const qualityRoles = {};
        const regular = [];
        for (const token of tokens) {
            if (!token.startsWith('@')) continue;
            const name = token.replace(/^@+/, '');
            const qr = QUALITY_ROLE.exec(name);
            if (qr) qualityRoles[qr[1]] = qr[2].toUpperCase();
            else regular.push(name);
        }
        if (regular.length) meta.resources = regular.join(', ');
        if (Object.keys(qualityRoles).length) meta.quality_roles = qualityRoles;

        // --- the task's own deliverable ---
        // A $token inside [depends ...] references another product, so it is
        // removed before looking (the bug the Python comment describes).
        const outsideDepends = line.replace(DEPENDS_BLOCK, '');
        const deliverable = DELIVERABLE.exec(outsideDepends);
        if (deliverable) {
            meta.deliverable = deliverable[2];
            meta.product_type = deliverable[1] === '/' ? 'group'
                : deliverable[1] === '^' ? 'external'
                    : 'internal';
        }

        // --- labels ---
        const labels = [...line.matchAll(LABEL)].map(m => m[1].trim());
        if (labels.length) meta.labels = labels;

        // --- dependencies, with types and lag/lead ---
        const bracket = BRACKET_DEP.exec(line);
        if (bracket) {
            const raw = bracket[1].trim();
            const depList = [];
            const lagLead = {};
            const depTypes = {};

            if (raw) {
                for (const spec of raw.split(',')) {
                    const trimmed = spec.trim();
                    if (!trimmed) continue;

                    const lag = LAG_LEAD.exec(trimmed);
                    if (lag) {
                        let depName = lag[1].trim();
                        const typed = DEP_TYPE.exec(depName);
                        if (typed) {
                            depName = typed[1].trim();
                            const type = typed[2].toUpperCase();
                            if (type !== 'FS') depTypes[depName] = type;
                        }
                        depList.push(depName);
                        lagLead[depName] = lag[2];
                    } else {
                        const typed = DEP_TYPE.exec(trimmed);
                        if (typed) {
                            const depName = typed[1].trim();
                            const type = typed[2].toUpperCase();
                            if (type !== 'FS') depTypes[depName] = type;
                            depList.push(depName);
                        } else {
                            depList.push(trimmed);
                        }
                    }
                }
            }

            if (Object.keys(lagLead).length) meta.lag_lead = lagLead;
            if (Object.keys(depTypes).length) meta.dependency_types = depTypes;
            meta.depends = depList;
        }

        // --- recurrence ---
        const recurrence = RECURRENCE.exec(line);
        if (recurrence) meta.recurrence = parseRecurrence(recurrence[1]);

        if (taskName) meta.name = taskName;
        if (line.startsWith('*')) meta.sequential = true;

        // --- bucket ---
        const bucket = BUCKET.exec(line);
        if (bucket) meta.bucket = bucket[1].trim();

        // --- priority ---
        const priority = PRIORITY.exec(line);
        if (priority) {
            meta.priority = priority[1] === '!!!' ? 'Urgent' : priority[1] === '!!' ? 'Important' : 'Medium';
        } else {
            meta.priority = 'Low';
        }

        // --- comment: !"…", then "…", then '…' ---
        const bang = BANG_COMMENT.exec(line);
        if (bang) {
            meta.comment = bang[1] !== undefined ? bang[1] : bang[2];
        } else {
            const dq = DQ_COMMENT.exec(line);
            if (dq) {
                meta.comment = dq[1];
            } else {
                const sq = SQ_COMMENT.exec(line);
                if (sq) meta.comment = sq[1];
            }
        }

        // --- effort, and the percent it implies ---
        const effort = EFFORT.exec(line);
        if (effort) {
            const completedVal = parseFloat(effort[1]);
            const completedUnit = effort[2];
            if (effort[3] !== undefined) {
                const totalVal = parseFloat(effort[3]);
                const totalUnit = effort[4];
                meta.effort_completed = completedVal;
                meta.effort_completed_unit = completedUnit;
                meta.effort_total = totalVal;
                meta.effort_total_unit = totalUnit;
                meta.effort_remaining = totalVal - completedVal;
                meta.effort_remaining_unit = totalUnit;
            } else {
                meta.effort_completed = 0;
                meta.effort_completed_unit = completedUnit;
                meta.effort_total = completedVal;
                meta.effort_total_unit = completedUnit;
                meta.effort_remaining = completedVal;
                meta.effort_remaining_unit = completedUnit;
            }
        }

        // --- percent complete ---
        const percent = PERCENT.exec(line);
        if (percent) {
            meta.percent = Math.max(0, Math.min(100, parseInt(percent[1], 10)));
        } else {
            const legacy = LEGACY_PERCENT.exec(line);
            if (legacy) meta.percent = Math.max(0, Math.min(100, parseInt(legacy[1], 10)));
        }

        // effort overrides the stated percent when both parts are present
        if (meta.effort_completed !== undefined && meta.effort_total !== undefined && meta.effort_total > 0) {
            const completedUnit = meta.effort_completed_unit || 'h';
            const totalUnit = meta.effort_total_unit || 'h';
            let completedHours = meta.effort_completed;
            let totalHours = meta.effort_total;
            if (completedUnit !== totalUnit) {
                completedHours = completedUnit === 'd' ? meta.effort_completed * 8 : meta.effort_completed;
                totalHours = totalUnit === 'd' ? meta.effort_total * 8 : meta.effort_total;
            }
            if (totalHours > 0) {
                // Python's round() is banker's rounding; JS Math.round is not,
                // so the half-way case is matched explicitly.
                meta.percent = Math.max(0, Math.min(100, bankersRound((completedHours / totalHours) * 100)));
            }
        }

        // --- levelled flag, which fixes the start, then any explicit date ---
        const levelled = LEVELLED.exec(line);
        let lineForDates = line;
        if (levelled) {
            meta.levelled = { resource: levelled[1].replace(/^@/, ''), start: levelled[2] };
            lineForDates = line.slice(0, levelled.index) + line.slice(levelled.index + levelled[0].length);
            meta.start = levelled[2];
            meta.due = levelled[2];
        } else {
            const date = DATE.exec(lineForDates);
            if (date) {
                meta.due = date[1];
                meta.start = date[1];
            }
        }

        // --- duration ---
        const duration = DURATION.exec(line);
        if (duration) {
            meta.duration_days = Number(duration[1]) * (DURATION_UNIT_DAYS[duration[2]] || 1);
        } else {
            const legacy = LEGACY_DURATION.exec(line);
            if (legacy) meta.duration_days = parseInt(legacy[1], 10);
        }

        // --- description: everything before the first metadata token ---
        const desc = DESCRIPTION.exec(line);
        if (desc) {
            meta.description = desc[1].trim().replace(PERCENT_TOKEN, '').trim();
        }

        return meta;
    }

    return {
        tokenize,
        metadata,
        extractMetadata,
        parseRecurrence,
        bankersRound,
        FRAGMENTS,
        DURATION_UNIT_DAYS,
    };
}));
