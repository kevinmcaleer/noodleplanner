/* Shared task-line grammar for parsing and syntax highlighting. */
const TaskLineTokenizer = (() => {
    const patterns = [
        ['comment', /["\u201c][^"\u201d]*["\u201d]/g],
        ['dependency', /\[depends(?::\s*|\s+)[^\]]+\]/gi],
        ['recurrence', /\[repeats\s+[^\]]+\]/gi],
        ['bucket', /\{[^}]+\}/g],
    ];
    const tokenPattern = /~\d+(?:\.\d+)?[hd](?:\/\d+(?:\.\d+)?[hd])?|(?<![\w!])(!!!|!!|!)(?![\w!"'{])|@\w+(?:\[\d+%\])?|#\w+|[/^]?\$[A-Za-z_][A-Za-z0-9_-]*|\b\d+[dmwy]\b|(?<!\w)\d+%(?!\w)|\bD\d{4}-\d{2}-\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/g;

    function addToken(tokens, line, type, start, end) {
        tokens.push({ type, start, end, text: line.slice(start, end) });
    }

    function tokenize(line) {
        const tokens = [];
        const protectedRanges = [];
        const trimmedStart = line.search(/\S/);
        if (trimmedStart !== -1 && line[trimmedStart] === '*') {
            addToken(tokens, line, 'star', trimmedStart, trimmedStart + 1);
            const lag = /^[+\-]\d+[dwmy]\b/.exec(line.slice(trimmedStart + 1).trimStart());
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
                : text[0] === 'D' ? 'deadline'
                : /^\d{4}-/.test(text) ? 'date'
                : 'duration';
            addToken(tokens, line, type, start, start + text.length);
        }
        return tokens.sort((a, b) => a.start - b.start || b.end - a.end);
    }

    function metadata(line) {
        const tokens = tokenize(line);
        const values = {
            name: '', duration: '', startDate: '', finishDate: '', deadline: '', percent: '',
            resources: [], labels: [], comment: '', priority: 'Low', bucket: '',
            dependencies: [], recurrence: '', product_type: undefined, deliverable: undefined,
            deadline: '',
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
            else if (token.type === 'deadline' && !values.deadline) values.deadline = text.slice(1);
            else if (token.type === 'product') {
                values.product_type = text[0] === '/' ? 'group' : text[0] === '^' ? 'external' : 'internal';
                values.deliverable = text.replace(/^[/^]?\$/, '');
            } else if (token.type === 'effort' && !values.effortTotal) {
                const effort = /^~(\d+(?:\.\d+)?)([hd])(?:\/(\d+(?:\.\d+)?)([hd]))?$/.exec(text);
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

    return { tokenize, metadata };
})();
