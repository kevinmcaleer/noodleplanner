/**
 * estimating.js — three-point (PERT) estimating popup (#1053).
 *
 * A popup taking optimistic / most likely / pessimistic values (or a
 * t-shirt size, as an alternative input mode), PERT-weighting them
 * ((O + 4M + P) / 6), and writing the resulting duration back to a task
 * in the plan's existing duration syntax. The three raw inputs are
 * recorded too -- not just the derived duration -- in a new
 * ``---estimates---`` back-matter section, so the popup can be reopened
 * later with the same values (see docs/reference/plan-syntax.rst).
 *
 * Storage design: the raw inputs live in back matter, not on the task
 * line itself. A back-matter table is invisible to every task-line
 * grammar (task-tokenizer.js, the JS scheduling engine, and Python's
 * front-matter/task-outline parsing all already stop at the first
 * recognised ``---section---`` marker), so recording them can never
 * confuse a duration/resource/dependency parser the way a new inline
 * bracket token would risk doing. Only the *derived* duration -- already
 * a token every parser understands -- is written onto the task line
 * itself, via TaskLineTokenizer's real token positions (setTaskDuration
 * below), never blind regex.
 */
(function (root) {
    const PlanModel = root.NoodlePlanModel ? root.NoodlePlanModel.PlanModel :
        (typeof require === 'function' ? require('./plan-model.js').PlanModel : null);
    const Tokenizer = typeof TaskLineTokenizer !== 'undefined' ? TaskLineTokenizer :
        (typeof require === 'function' ? require('./task-tokenizer.js') : null);

    const ESTIMATES_START = '---estimates---';
    // Every other back-matter marker, for boundary scanning -- mirrors
    // format_converter.py's ALL_SECTION_MARKERS (estimates is canonically
    // the last section, so nothing needs to follow it, but stay defensive
    // in case hand-edited text puts something after it anyway).
    const OTHER_MARKERS = [
        '---highlights---', '---end-highlights---', '---budget---', '---benefits---',
        '---raid log---', '---comms---', '---lessons learned---', '---baseline---',
        '---whiteboard---', '---parking lot---',
    ];

    // Default t-shirt size -> duration-in-days mapping (#1053's alternative
    // input mode for sprint-estimated plans, per #766). No per-project
    // customisation yet -- a reasonable, documented starting point.
    const TSHIRT_DAYS = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
    const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

    function calculatePert(optimistic, mostLikely, pessimistic) {
        // Number('') is 0, not NaN -- but an empty popup input field means
        // "not entered yet", not "zero days", so reject blank strings
        // explicitly rather than silently computing a PERT value from them.
        if ([optimistic, mostLikely, pessimistic].some(v => String(v).trim() === '')) return null;
        const o = Number(optimistic);
        const m = Number(mostLikely);
        const p = Number(pessimistic);
        if (!isFinite(o) || !isFinite(m) || !isFinite(p)) return null;
        return (o + 4 * m + p) / 6;
    }

    function daysToDurationText(days) {
        const rounded = Math.max(1, Math.round(days));
        return rounded + 'd';
    }

    // ---- Back-matter read/write (mirrors extractParkingLotFromPlanText /
    // updatePlanParkingLotText / generateParkingLotText in script.js) ----

    function extractEstimatesFromPlanText(planText) {
        if (!planText) return '';
        const startIdx = planText.indexOf(ESTIMATES_START);
        if (startIdx === -1) return '';
        const afterStart = startIdx + ESTIMATES_START.length;

        let endIdx = planText.length;
        for (const marker of OTHER_MARKERS) {
            const mIdx = planText.indexOf(marker, afterStart);
            if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
        }
        return planText.substring(afterStart, endIdx).trim();
    }

    /** Mirrors format_converter.py's parse_estimates_markdown -- keep both in sync. */
    function parseEstimatesMarkdown(text) {
        if (!text) return [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        function parseRow(line) {
            let parts = line.split(/(?<!\\)\|/);
            if (parts.length && !parts[0].trim()) parts = parts.slice(1);
            if (parts.length && !parts[parts.length - 1].trim()) parts = parts.slice(0, -1);
            return parts.map(c => c.trim());
        }

        let headerIndex = -1;
        let headers = [];
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes('|')) continue;
            const cells = parseRow(lines[i]).map(c => c.toLowerCase());
            if (cells.includes('task') && cells.some(c => c.includes('optimistic'))) {
                headerIndex = i;
                headers = cells;
                break;
            }
        }
        if (headerIndex === -1) return [];

        const aliases = {
            task: 'task', optimistic: 'optimistic', 'most likely': 'mostLikely',
            pessimistic: 'pessimistic', mode: 'mode', size: 'size',
        };
        const colMap = {};
        headers.forEach((h, idx) => {
            for (const [alias, field] of Object.entries(aliases)) {
                if (h.includes(alias)) { colMap[field] = idx; break; }
            }
        });

        const records = [];
        for (let i = headerIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes('|')) continue;
            if (/^[-|\s]+$/.test(line)) continue;
            if (line.startsWith('//')) continue;

            const cells = parseRow(line);
            if (!cells.length) continue;

            const getCell = (field, fallback) => {
                const idx = colMap[field];
                return idx !== undefined && idx < cells.length ? cells[idx].replace(/\\\|/g, '|') : fallback;
            };

            const task = getCell('task', '');
            if (!task) continue;

            const mode = getCell('mode', 'duration');
            records.push({
                task,
                optimistic: getCell('optimistic', ''),
                mostLikely: getCell('mostLikely', ''),
                pessimistic: getCell('pessimistic', ''),
                mode: mode === 'tshirt' ? 'tshirt' : 'duration',
                size: getCell('size', ''),
            });
        }
        return records;
    }

    function generateEstimatesText(records) {
        if (!records || !records.length) return '';
        const headers = ['Task', 'Optimistic', 'Most Likely', 'Pessimistic', 'Mode', 'Size'];
        const escapePipe = (value) => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

        const rows = records.map(r => [
            escapePipe(r.task), escapePipe(r.optimistic), escapePipe(r.mostLikely),
            escapePipe(r.pessimistic), escapePipe(r.mode), escapePipe(r.size),
        ]);

        const widths = headers.map(h => h.length);
        rows.forEach(row => row.forEach((cell, i) => { widths[i] = Math.max(widths[i], cell.length); }));

        const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
        const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
        const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

        const lines = [formatRow(headers), separator];
        rows.forEach(row => lines.push(formatRow(row)));
        return lines.join('\n');
    }

    /** Estimates is canonically the last back-matter section, so (like
     * updatePlanParkingLotText) nothing needs to be preserved and
     * re-appended after it -- but stay defensive in case something
     * follows it in hand-edited text anyway. */
    function updatePlanEstimatesText(planText, records) {
        const startIdx = planText.indexOf(ESTIMATES_START);
        let before = planText;
        let after = '';
        if (startIdx !== -1) {
            const afterStart = startIdx + ESTIMATES_START.length;
            let endIdx = planText.length;
            for (const marker of OTHER_MARKERS) {
                const mIdx = planText.indexOf(marker, afterStart);
                if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
            }
            before = planText.substring(0, startIdx);
            after = planText.substring(endIdx);
        }
        before = before.replace(/\n+$/, '');

        const table = generateEstimatesText(records);
        let result = before;
        if (table) result = result + '\n\n' + ESTIMATES_START + '\n' + table;
        if (after) result = result.replace(/\n+$/, '') + '\n\n' + after.replace(/^\n+/, '');
        return result;
    }

    function findEstimateRecord(records, taskName) {
        return records.find(r => r.task === taskName) || null;
    }

    function upsertEstimateRecord(records, taskName, patch) {
        const idx = records.findIndex(r => r.task === taskName);
        const base = idx === -1
            ? { task: taskName, optimistic: '', mostLikely: '', pessimistic: '', mode: 'duration', size: '' }
            : records[idx];
        const merged = { ...base, ...patch };
        if (idx === -1) return records.concat([merged]);
        const copy = records.slice();
        copy[idx] = merged;
        return copy;
    }

    // ---- Task-line write-back, via real token positions, never blind regex ----

    function setTaskDuration(lineContent, durationText) {
        const tokens = Tokenizer.tokenize(lineContent);
        const durationToken = tokens.find(t => t.type === 'duration');
        if (durationToken) {
            return lineContent.slice(0, durationToken.start) + durationText + lineContent.slice(durationToken.end);
        }
        // No existing duration: insert right before the first token that
        // isn't part of the name (star/star-lag are part of the sequential
        // prefix, not the name, so they're excluded from that search too).
        const firstOtherToken = tokens.find(t => t.type !== 'star' && t.type !== 'star-lag');
        if (firstOtherToken) {
            const before = lineContent.slice(0, firstOtherToken.start).replace(/\s+$/, '');
            return before + ' ' + durationText + ' ' + lineContent.slice(firstOtherToken.start);
        }
        return lineContent.replace(/\s+$/, '') + ' ' + durationText;
    }

    /**
     * Apply a three-point (or t-shirt) estimate to a named task within
     * plan text, returning the updated plan text. Pure function: no DOM,
     * no globals besides PlanModel/TaskLineTokenizer.
     *
     * @param {string} planText
     * @param {string} taskName
     * @param {{mode:'duration', optimistic:number|string, mostLikely:number|string, pessimistic:number|string}
     *         | {mode:'tshirt', size:string}} input
     * @returns {{text: string, days: number|null}} the updated plan text,
     *   and the computed day count (null if input was invalid and nothing changed)
     */
    function applyEstimate(planText, taskName, input) {
        const model = PlanModel.parse(planText);
        const task = model.findByName(taskName);
        if (!task) return { text: planText, days: null };

        let days;
        if (input.mode === 'tshirt') {
            days = TSHIRT_DAYS[input.size] != null ? TSHIRT_DAYS[input.size] : TSHIRT_DAYS.M;
        } else {
            days = calculatePert(input.optimistic, input.mostLikely, input.pessimistic);
            if (days == null) return { text: planText, days: null };
        }

        const durationText = daysToDurationText(days);
        model.updateLine(task, (line) => setTaskDuration(line, durationText));
        const text = model.serialize();

        const records = parseEstimatesMarkdown(extractEstimatesFromPlanText(text));
        const patch = input.mode === 'tshirt'
            ? { optimistic: '', mostLikely: '', pessimistic: '', mode: 'tshirt', size: input.size }
            : {
                optimistic: String(input.optimistic), mostLikely: String(input.mostLikely),
                pessimistic: String(input.pessimistic), mode: 'duration', size: '',
            };
        const updatedRecords = upsertEstimateRecord(records, taskName, patch);
        return { text: updatePlanEstimatesText(text, updatedRecords), days };
    }

    // ---- Popup UI: a self-contained overlay, injected/removed on open/close ----

    function el(tag, className, attrs) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
        return node;
    }

    /**
     * Open the estimating popup for a task.
     * @param {{getText():string, setText(text:string):void, taskName:string}} options
     */
    function openEstimatePopup(options) {
        const { getText, setText, taskName } = options;
        const existing = document.getElementById('estimatePopupOverlay');
        if (existing) existing.remove();

        const records = parseEstimatesMarkdown(extractEstimatesFromPlanText(getText()));
        const record = findEstimateRecord(records, taskName) || {
            optimistic: '', mostLikely: '', pessimistic: '', mode: 'duration', size: '',
        };

        const overlay = el('div', 'estimate-popup-overlay', { id: 'estimatePopupOverlay' });
        const dialog = el('div', 'estimate-popup');
        dialog.innerHTML = `
            <div class="estimate-popup-header">
                <span>Estimate: ${escapeEstimateHtml(taskName)}</span>
                <np-close-button flat></np-close-button>
            </div>
            <div class="estimate-popup-mode-tabs">
                <button type="button" class="estimate-mode-btn" data-mode="duration">Three-point</button>
                <button type="button" class="estimate-mode-btn" data-mode="tshirt">T-shirt size</button>
            </div>
            <div class="estimate-popup-body">
                <div class="estimate-duration-fields">
                    <label>Optimistic (days)<input type="number" min="0" step="0.5" id="estimateOptimistic"></label>
                    <label>Most likely (days)<input type="number" min="0" step="0.5" id="estimateMostLikely"></label>
                    <label>Pessimistic (days)<input type="number" min="0" step="0.5" id="estimatePessimistic"></label>
                </div>
                <div class="estimate-tshirt-fields">
                    ${TSHIRT_SIZES.map(size => `<button type="button" class="estimate-tshirt-btn" data-size="${size}">${size}</button>`).join('')}
                </div>
                <div class="estimate-preview">PERT duration: <strong id="estimatePreview">-</strong></div>
            </div>
            <div class="estimate-popup-footer">
                <button type="button" class="estimate-popup-cancel">Cancel</button>
                <button type="button" class="estimate-popup-save">Save</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const optimisticInput = dialog.querySelector('#estimateOptimistic');
        const mostLikelyInput = dialog.querySelector('#estimateMostLikely');
        const pessimisticInput = dialog.querySelector('#estimatePessimistic');
        const preview = dialog.querySelector('#estimatePreview');
        const durationFields = dialog.querySelector('.estimate-duration-fields');
        const tshirtFields = dialog.querySelector('.estimate-tshirt-fields');

        optimisticInput.value = record.optimistic || '';
        mostLikelyInput.value = record.mostLikely || '';
        pessimisticInput.value = record.pessimistic || '';

        let mode = record.mode === 'tshirt' ? 'tshirt' : 'duration';
        let selectedSize = record.size || 'M';

        function setMode(newMode) {
            mode = newMode;
            dialog.querySelectorAll('.estimate-mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            durationFields.style.display = mode === 'duration' ? '' : 'none';
            tshirtFields.style.display = mode === 'tshirt' ? '' : 'none';
            updatePreview();
        }

        function updatePreview() {
            if (mode === 'tshirt') {
                const days = TSHIRT_DAYS[selectedSize];
                preview.textContent = days != null ? daysToDurationText(days) : '-';
            } else {
                const days = calculatePert(optimisticInput.value, mostLikelyInput.value, pessimisticInput.value);
                preview.textContent = days != null ? daysToDurationText(days) : '-';
            }
        }

        dialog.querySelectorAll('.estimate-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => setMode(btn.dataset.mode));
        });
        dialog.querySelectorAll('.estimate-tshirt-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedSize = btn.dataset.size;
                dialog.querySelectorAll('.estimate-tshirt-btn').forEach(b => b.classList.toggle('active', b === btn));
                updatePreview();
            });
        });
        [optimisticInput, mostLikelyInput, pessimisticInput].forEach(input => {
            input.addEventListener('input', updatePreview);
        });

        function close() { overlay.remove(); }
        dialog.querySelector('np-close-button').addEventListener('close', close);
        dialog.querySelector('.estimate-popup-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

        dialog.querySelector('.estimate-popup-save').addEventListener('click', () => {
            const input = mode === 'tshirt'
                ? { mode: 'tshirt', size: selectedSize }
                : {
                    mode: 'duration', optimistic: optimisticInput.value,
                    mostLikely: mostLikelyInput.value, pessimistic: pessimisticInput.value,
                };
            const result = applyEstimate(getText(), taskName, input);
            if (result.days != null) setText(result.text);
            close();
        });

        setMode(mode);
        dialog.querySelectorAll('.estimate-tshirt-btn').forEach(b => b.classList.toggle('active', b.dataset.size === selectedSize));
    }

    function escapeEstimateHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const api = {
        calculatePert, daysToDurationText, TSHIRT_DAYS, TSHIRT_SIZES,
        extractEstimatesFromPlanText, parseEstimatesMarkdown, generateEstimatesText,
        updatePlanEstimatesText, findEstimateRecord, upsertEstimateRecord,
        setTaskDuration, applyEstimate, openEstimatePopup,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.EstimatingTool = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
