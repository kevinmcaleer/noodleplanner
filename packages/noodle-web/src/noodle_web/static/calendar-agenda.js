/**
 * calendar-agenda.js -- the calendar as an agenda on a phone (#1387, epic
 * #1376).
 *
 * A month grid at 390px has day cells about 45px wide: a task's name is two
 * letters and a "+3 more". On a phone the Calendar view opens on an agenda
 * instead -- what is on today, then what starts or falls due on each of the
 * next seven days -- with the month grid a tap away (Agenda / Month, an
 * <np-view-chips>, remembered). Tablets and desktops keep the grid.
 *
 * It reads the same tasks the grid does (script.js's calendarTasks: every
 * scheduled task with a start and a finish), and a tap on an item opens that
 * task the way the grid's does (openMilestoneTaskForm()).
 *
 * agenda() is pure, and tests/test_calendar_agenda.mjs runs it in node.
 *
 * A classic script exposing `NoodleCalendarAgenda`, after script.js.
 */
(function (root) {
    'use strict';

    const MODE_KEY = 'noodleplanner:calendar-phone-mode';
    const MODES = [{ id: 'agenda', label: 'Agenda' }, { id: 'month', label: 'Month' }];
    const WEEK_DAYS = 7;
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** "2026-03-05" -> a local-midnight Date, or null. */
    function day(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
    }

    function isoOf(date) {
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${m}-${d}`;
    }

    function addDays(date, n) {
        const next = new Date(date);
        next.setDate(next.getDate() + n);
        return next;
    }

    function isDone(task) {
        return (parseFloat(task.percent) || 0) >= 100;
    }

    /**
     * What is on today, and what starts or is due on each of the next seven
     * days:
     *
     *   { today: [{ task, kind }], days: [{ date, items: [{ task, kind }] }] }
     *
     * `kind` is 'due' (finishes that day), 'starts', or 'on' (today only: in
     * progress, neither starting nor finishing). A day with nothing is left
     * out. Within a day, what is due comes first, then what starts.
     */
    function agenda(tasks, today) {
        const start = today ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : new Date();
        start.setHours(0, 0, 0, 0);
        const todayIso = isoOf(start);
        const order = { due: 0, starts: 1, on: 2 };
        const byOrder = (a, b) => order[a.kind] - order[b.kind] || String(a.task.name).localeCompare(String(b.task.name));

        const todays = [];
        for (const task of tasks || []) {
            const s = day(task.start);
            const f = day(task.finish);
            if (!s || !f || s > start || f < start) continue;
            const kind = task.finish.slice(0, 10) === todayIso ? 'due'
                : task.start.slice(0, 10) === todayIso ? 'starts' : 'on';
            todays.push({ task, kind });
        }

        const days = [];
        for (let offset = 1; offset <= WEEK_DAYS; offset++) {
            const date = addDays(start, offset);
            const iso = isoOf(date);
            const items = [];
            for (const task of tasks || []) {
                if (String(task.finish || '').slice(0, 10) === iso) items.push({ task, kind: 'due' });
                else if (String(task.start || '').slice(0, 10) === iso) items.push({ task, kind: 'starts' });
            }
            if (items.length) days.push({ date: iso, items: items.sort(byOrder) });
        }
        return { today: todays.sort(byOrder), days };
    }

    function dayLabel(iso, today) {
        const date = day(iso);
        const offset = Math.round((date - today) / 86400000);
        const name = offset === 1 ? 'Tomorrow' : DAY_NAMES[date.getDay()];
        return `${name} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
    }

    // ── Rendering ───────────────────────────────────────────────────────

    function mode() {
        try {
            return root.localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'agenda';
        } catch (_) {
            return 'agenda';
        }
    }

    function isPhone() {
        return !!(root.NoodleLayout && root.NoodleLayout.isPhone());
    }

    function item({ task, kind }) {
        const li = document.createElement('li');
        li.className = 'calendar-agenda-item' + (isDone(task) ? ' calendar-agenda-item-done' : '');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'calendar-agenda-open';
        const name = document.createElement('span');
        name.className = 'calendar-agenda-name';
        name.textContent = task.name;
        const when = document.createElement('span');
        when.className = `calendar-agenda-kind calendar-agenda-kind-${kind}`;
        when.textContent = kind === 'due' ? 'Due' : kind === 'starts' ? 'Starts' : 'In progress';
        button.append(name, when);
        if (task.resources) {
            const who = document.createElement('span');
            who.className = 'calendar-agenda-who';
            who.textContent = String(task.resources);
            button.appendChild(who);
        }
        button.addEventListener('click', () => {
            if (typeof root.openMilestoneTaskForm === 'function') root.openMilestoneTaskForm(task.name);
        });
        li.appendChild(button);
        return li;
    }

    function section(title, items, emptyText) {
        const wrap = document.createElement('section');
        wrap.className = 'calendar-agenda-day';
        const heading = document.createElement('h3');
        heading.className = 'calendar-agenda-heading';
        heading.textContent = title;
        wrap.appendChild(heading);
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'calendar-agenda-empty';
            empty.textContent = emptyText;
            wrap.appendChild(empty);
            return wrap;
        }
        const list = document.createElement('ul');
        list.className = 'calendar-agenda-list';
        list.append(...items.map(item));
        wrap.appendChild(list);
        return wrap;
    }

    function render() {
        const view = document.getElementById('calendar-view');
        const box = document.getElementById('calendarAgenda');
        const chips = document.getElementById('calendarModeChips');
        if (!view || !box) return;
        const phone = isPhone();
        const current = phone ? mode() : 'month';
        view.dataset.calendarMode = current;
        if (chips) {
            if (!chips.views || !chips.views.length) chips.views = MODES;
            chips.hidden = !phone;
            chips.setAttribute('active', current);
        }
        box.hidden = current !== 'agenda';
        if (current !== 'agenda') return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tasks = typeof calendarTasks !== 'undefined' ? calendarTasks : [];
        const { today: now, days } = agenda(tasks, today);
        const parts = [section(`Today, ${today.getDate()} ${MONTHS[today.getMonth()]}`, now, 'Nothing on today.')];
        for (const entry of days) parts.push(section(dayLabel(entry.date, today), entry.items, ''));
        if (!days.length) {
            const quiet = document.createElement('p');
            quiet.className = 'calendar-agenda-empty';
            quiet.textContent = 'Nothing starts or is due in the next seven days.';
            parts.push(quiet);
        }
        box.replaceChildren(...parts);
    }

    function setMode(next) {
        try {
            root.localStorage.setItem(MODE_KEY, next === 'month' ? 'month' : 'agenda');
        } catch (_) { /* storage unavailable: the choice lasts for the page */ }
        render();
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('select', (event) => {
            if (event.target && event.target.id === 'calendarModeChips') setMode(event.detail.id);
        });
        document.addEventListener('layoutchange', render);
    }

    root.NoodleCalendarAgenda = { MODE_KEY, agenda, render, setMode };
})(typeof globalThis !== 'undefined' ? globalThis : this);
