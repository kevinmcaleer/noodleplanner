/**
 * editor-sync.js — Sync functions between Gantt/table edits and the plan editor.
 * Depends on: state.js (globals), task-tokenizer.js, plan-model.js
 *
 * Every sync finds its task through the plan model -- by the rendered task's
 * _uid, else its row -- never by matching its name against the text (#747,
 * #921), and rewrites the field with updateLineField(), the one token editor
 * over the shared task-line grammar (#563).
 */

function updateEditorTaskViaModel(editor, task, taskIndex, updater) {
    const model = NoodlePlanModel.modelForEditor(editor);
    const node = task && task._uid != null ? model.findById(task._uid) : model.taskAt(taskIndex);
    if (!node || !model.updateLine(node, updater)) {
        console.error('Task not found in editor!', { name: task && task.name, level: task && task.level });
        return false;
    }
    NoodlePlanModel.commitToEditor(editor, model);
    return true;
}

/**
 * Set, replace or remove one field of a task line through the task-line
 * grammar in task-tokenizer.js, which the parser and the highlighter read
 * too. `type` is a token type ('percent', 'date', 'priority', ...), `value`
 * the new token text, or '' to remove the field.
 *
 *   nth           which occurrence to set -- the finish date is date 1
 *   all           replace every occurrence (resources, priority) with `value`
 *   after         token types a missing field goes after (the last one on
 *                 the line); with none of them present it goes straight
 *                 after the name
 *   requireAfter  add a missing field only after one of `after` -- a finish
 *                 date without a start would be read as the start
 *   append        add a missing field at the end of the line
 */
function updateLineField(line, type, value, options = {}) {
    const { nth = 0, all = false, after = [], requireAfter = false, append = false } = options;
    const tokens = TaskLineTokenizer.tokenize(line)
        .filter(token => token.type !== 'star' && token.type !== 'star-lag');
    const matching = tokens.filter(token => token.type === type);
    const targets = all ? matching : matching.slice(nth, nth + 1);

    if (targets.length) {
        let updated = line;
        for (let i = targets.length - 1; i >= 0; i--) {
            updated = spliceLineToken(updated, targets[i], i === 0 ? value : '');
        }
        return updated.trimEnd();
    }
    if (!value) return line;
    if (append) return line.trimEnd() + ' ' + value;
    const anchors = tokens.filter(token => after.includes(token.type));
    if (anchors.length) {
        const anchor = anchors[anchors.length - 1];
        return line.slice(0, anchor.end) + ' ' + value + line.slice(anchor.end);
    }
    if (requireAfter) return line;
    if (tokens.length) {
        return line.slice(0, tokens[0].start) + value + ' ' + line.slice(tokens[0].start);
    }
    return line.trimEnd() + ' ' + value;
}

/** Replace a token's text, or remove it with one space beside it. */
function spliceLineToken(line, token, text) {
    if (text) return line.slice(0, token.start) + text + line.slice(token.end);
    let start = token.start;
    let end = token.end;
    if (line[start - 1] === ' ') start--;
    else if (line[end] === ' ') end++;
    return line.slice(0, start) + line.slice(end);
}

function syncGanttEditToEditor(task, taskIndex, field, newValue, oldName = null) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const model = NoodlePlanModel.modelForEditor(editor);
    const node = task && task._uid != null ? model.findById(task._uid) : model.taskAt(taskIndex);
    if (!node) return;
    if (field === 'name') {
        model.rename(node, newValue);
    } else {
        const value = String(newValue || '').trim();
        model.updateLine(node, line => {
            if (field === 'resources') {
                const people = value.split(/[,\s]+/).filter(Boolean)
                    .map(person => '@' + person.replace(/^@/, ''));
                return updateLineField(line, 'resource', people.join(' '), { all: true });
            }
            if (field === 'comment') return updateLineField(line, 'comment', value && `"${value}"`, { all: true, append: true });
            if (field === 'bucket') return updateLineField(line, 'bucket', value && `{${value}}`, { append: true });
            return line;
        });
    }
    NoodlePlanModel.commitToEditor(editor, model);
}

function syncGanttPriorityToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const priorityMarkers = { 'Urgent': '!!!', 'Important': '!!', 'Medium': '!' };
    const marker = priorityMarkers[task.priority] || '';
    updateEditorTaskViaModel(editor, task, taskIndex, line =>
        updateLineField(line, 'priority', marker, { all: true }));
}

function syncGanttDurationToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;
    updateEditorTaskViaModel(editor, task, taskIndex, line =>
        updateDurationInLine(line, task.duration_days));
}

function syncGanttStartDateToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;
    updateEditorTaskViaModel(editor, task, taskIndex, line =>
        updateStartDateInLine(line, task.start));
}

function syncGanttFinishDateToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;
    updateEditorTaskViaModel(editor, task, taskIndex, line =>
        updateFinishDateInLine(line, task.finish));
}

/**
 * Creates a mini piechart element that visually represents task completion percentage.
 * Replaces the traditional checkbox for tasks.
 * - Click: toggles between 100% and 0%
 * - Long press: shows a popup to set 0%, 25%, 50%, 75%, or 100%
 *
 * @param {number} percent - Current completion percentage (0-100)
 * @param {function} onPercentChange - Callback when percent changes, receives new percent string like '50%'
 * @returns {HTMLElement} The piechart div element
 */
function createMiniPiechart(percent, onPercentChange) {
    const piechart = document.createElement('div');
    piechart.className = 'mini-piechart';

    updatePiechartAppearance(piechart, percent);

    // A press and hold -- mouse, finger or pen -- opens the popup, through the
    // app's one long-press (touch-gestures.js, #1386), which also swallows the
    // click that ends the hold; a plain click or tap toggles.
    if (typeof NoodleTouch !== 'undefined') {
        NoodleTouch.onLongPress(piechart, () => {
            showPiechartPopup(piechart, percent, (newPercent) => {
                percent = newPercent;
                updatePiechartAppearance(piechart, percent);
                onPercentChange(percent + '%');
            });
        }, { pointerTypes: ['mouse', 'touch', 'pen'] });
    }
    // The row behind has its own click (open the task) and press (a drag).
    piechart.addEventListener('pointerdown', (e) => e.stopPropagation());
    piechart.addEventListener('mousedown', (e) => e.stopPropagation());
    piechart.addEventListener('click', (e) => {
        e.stopPropagation();
        percent = percent >= 100 ? 0 : 100;
        updatePiechartAppearance(piechart, percent);
        onPercentChange(percent + '%');
    });

    return piechart;
}

function spawnConfetti(element) {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colours = ['#28a745', '#ffc107', '#17a2b8', '#ff6b6b', '#6f42c1', '#fd7e14'];
    for (let i = 0; i < 16; i++) {
        const dot = document.createElement('div');
        dot.className = 'confetti-particle';
        const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.4;
        const dist = 20 + Math.random() * 25;
        dot.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
        dot.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
        dot.style.left = cx + 'px';
        dot.style.top = cy + 'px';
        dot.style.background = colours[Math.floor(Math.random() * colours.length)];
        document.body.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove());
    }
}

function updatePiechartAppearance(element, percent) {
    if (percent >= 100) {
        element.classList.add('complete');
        element.style.removeProperty('--percent');
        element.style.background = '';
        element.title = 'Mark incomplete';
        spawnConfetti(element);
    } else {
        element.classList.remove('complete');
        element.style.setProperty('--percent', percent + '%');
        element.style.background = `conic-gradient(#28a745 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
        element.title = percent > 0 ? `${percent}% complete - click to complete` : 'Mark complete';
    }
}

function showPiechartPopup(piechartElement, currentPercent, onSelect) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.piechart-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.className = 'piechart-popup';

    const options = [0, 25, 50, 75, 100];
    options.forEach(value => {
        const btn = document.createElement('button');
        btn.className = 'piechart-popup-btn';
        btn.textContent = value + '%';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(value);
            popup.remove();
        });
        popup.appendChild(btn);
    });

    // Position the popup near the piechart
    document.body.appendChild(popup);
    const rect = piechartElement.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (rect.left + window.scrollX - 60) + 'px';

    // Close on click outside
    const closeHandler = (e) => {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener('pointerdown', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 10);
}

function syncGanttPercentToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;
    updateEditorTaskViaModel(editor, task, taskIndex, line =>
        updatePercentInLine(line, task.percent));
}

function syncGanttPredecessorsToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    let depends = '';
    if (task.depends && task.depends.length) {
        const types = task.dependency_types || {};
        const parts = task.depends.map(name => {
            const type = types[name] && types[name] !== 'FS' ? ':' + types[name] : '';
            const lag = task.lag_lead && task.lag_lead[name] ? ' ' + task.lag_lead[name] : '';
            return name + type + lag;
        });
        depends = '[depends ' + parts.join(', ') + ']';
    }
    updateEditorTaskViaModel(editor, task, taskIndex, line =>
        updateLineField(line, 'dependency', depends, { append: true }));
}

function updateDurationInLine(line, newDurationDays) {
    // gantt-scale.js rewrites the token the scheduler actually reads, and
    // appends a missing duration at the end of the line rather than after
    // the first word (which split multi-word names: "Design 2d UI").
    if (typeof GanttScale !== 'undefined') {
        return GanttScale.setLineDuration(line, newDurationDays);
    }
    return updateLineField(line, 'duration', `${newDurationDays}d`);
}

function updateStartDateInLine(line, newStartDate) {
    // As updateDurationInLine: the date the scheduler reads, never a D-deadline
    if (typeof GanttScale !== 'undefined') {
        return GanttScale.setLineStart(line, newStartDate);
    }
    return updateLineField(line, 'date', newStartDate, { after: ['duration', 'resource', 'percent'] });
}

function updateFinishDateInLine(line, newFinishDate) {
    return updateLineField(line, 'date', newFinishDate, { nth: 1, after: ['date'], requireAfter: true });
}

function updatePercentInLine(line, newPercent) {
    return updateLineField(line, 'percent', newPercent, { after: ['duration', 'effort'] });
}
