/**
 * kanban-card-menu.js -- the board card's action menu, opened by right-click or
 * a long-press (touch-parity.js raises the same `contextmenu` for a finger).
 *
 * It is an <np-menu> (components/menu/np-menu.js) filled from the card:
 * Rename, Progress 0-100%, Label / Bucket / Resource (each drills into the
 * ones the plan already has, plus a "New ..." entry), Add dependent task,
 * Delete. The menu only chooses; every change goes through the Kanban board's
 * own card methods (kanban.js "Card context menu"), so each is one model edit
 * and one write to the editor.
 *
 * A classic script, loaded before kanban.js.
 */
(function (root) {
    'use strict';

    const PROGRESS = [0, 25, 50, 75, 100];
    const MARGIN = 8;

    let open = null;

    function close(refocus) {
        if (!open) return;
        const state = open;
        open = null;
        document.removeEventListener('pointerdown', state.outside, true);
        window.removeEventListener('scroll', state.onScroll, true);
        window.removeEventListener('resize', state.dismiss);
        window.removeEventListener('blur', state.dismiss);
        state.menu.remove();
        if (refocus) {
            const card = state.card.isConnected ? state.card : Array.from(document.querySelectorAll('.kanban-card'))
                .find((el) => el.getAttribute('data-task-name') === state.task.name);
            if (card) card.focus({ preventScroll: true });
        }
    }

    const tickable = (id, label, checked) => ({ id, label, checked });

    function mainSections(board, task) {
        const percent = task.percent === '' || task.percent == null ? null : Number(task.percent);
        const extras = [
            { id: 'view:label', label: 'Label…' },
            { id: 'view:bucket', label: 'Bucket…' },
            { id: 'view:resource', label: 'Resource…' },
        ];
        if (!board.hasSubtasks(task)) extras.push({ id: 'dependent', label: 'Add dependent task' });
        return [
            { items: [{ id: 'rename', label: 'Rename' }] },
            {
                label: 'Progress',
                items: PROGRESS.map((value) => tickable(`progress:${value}`, `${value}%`, percent === value)),
            },
            { items: extras },
            { items: [{ id: 'delete', label: 'Delete task', destructive: true, confirms: true }] },
        ];
    }

    function listSections(board, task, view) {
        const back = { items: [{ id: 'view:main', label: '‹ Back' }] };
        if (view === 'label') {
            const applied = task.labelsArray.map((label) => label.toLowerCase());
            const items = board.knownLabels().map((label) =>
                tickable(`label:${label}`, label, applied.includes(label.toLowerCase())));
            return [back, ...(items.length ? [{ label: 'Labels', items }] : []),
                { input: { id: 'new-label', placeholder: 'New label…', label: 'New label' } }];
        }
        if (view === 'bucket') {
            const current = task.bucket ? task.bucket.trim() : '';
            const items = board.knownBuckets().map((bucket) =>
                tickable(`bucket:${bucket}`, bucket, bucket === current));
            return [back, ...(items.length ? [{ label: 'Buckets', items }] : []),
                { input: { id: 'new-bucket', placeholder: 'New bucket…', label: 'New bucket' } }];
        }
        const applied = task.resourceShortnames;
        const items = board.knownResources().map(({ shortname, name }) =>
            tickable(`resource:${shortname}`, name && name !== shortname ? `${name} (@${shortname})` : `@${shortname}`,
                applied.includes(shortname.toLowerCase())));
        return [back, ...(items.length ? [{ label: 'Resources', items }] : []),
            { input: { id: 'new-resource', placeholder: 'New resource @name…', label: 'New resource' } }];
    }

    function place(state) {
        const { menu, x, y } = state;
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
        const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    function show(state, view) {
        const { board, task, menu } = state;
        state.view = view;
        menu.sections = view === 'main' ? mainSections(board, task) : listSections(board, task, view);
        menu.setAttribute('aria-label', view === 'main' ? 'Task actions' : `${view[0].toUpperCase()}${view.slice(1)}s`);
        place(state);
        const first = menu.items[0];
        const entry = menu.querySelector('.wb-note-menu-input');
        // A list view with nothing to pick lands on the entry; otherwise the first item.
        (view !== 'main' && menu.items.length <= 1 && entry ? entry : first || entry).focus();
    }

    function run(state, detail) {
        const { board, task, column, card } = state;
        const id = detail.id;
        if (id.startsWith('view:')) { show(state, id.slice(5)); return; }

        close(false);
        if (id === 'rename') {
            const title = card.querySelector('.kanban-card-title');
            if (title) board.startInlineCardTitleRename(title, task);
        } else if (id.startsWith('progress:')) {
            board.quickSetPercent(task, Number(id.slice(9)), card);
        } else if (id.startsWith('label:')) {
            board.toggleCardLabel(task, id.slice(6));
        } else if (id === 'new-label') {
            const label = board.normaliseLabel(detail.value);
            if (label) board.toggleCardLabel(task, label);
        } else if (id.startsWith('bucket:')) {
            board.setCardBucket(task, id.slice(7));
        } else if (id === 'new-bucket') {
            const bucket = String(detail.value || '').replace(/[{}]/g, '').trim();
            if (bucket) board.setCardBucket(task, bucket);
        } else if (id.startsWith('resource:')) {
            board.toggleCardResource(task, id.slice(9));
        } else if (id === 'new-resource') {
            const shortname = String(detail.value || '').replace(/^@/, '').trim().replace(/[^\w]+/g, '');
            if (shortname && !task.resourceShortnames.includes(shortname.toLowerCase())) {
                board.toggleCardResource(task, shortname);
            }
        } else if (id === 'dependent') {
            board.addDependentTask(task, column);
        } else if (id === 'delete') {
            board.deleteCardTask(task);
        }
    }

    function openMenu(board, task, column, card, event) {
        close(false);
        const rect = card.getBoundingClientRect();
        // A keyboard-raised menu (Shift+F10) has no pointer: use the card.
        const keyboard = !event.clientX && !event.clientY;
        const menu = document.createElement('np-menu');
        const state = {
            board, task, column, card, menu, view: 'main',
            x: keyboard ? rect.left + MARGIN : event.clientX,
            y: keyboard ? rect.top + MARGIN : event.clientY,
        };
        state.dismiss = () => close(true);
        state.outside = (e) => { if (!menu.contains(e.target)) close(false); };
        state.onScroll = (e) => { if (!menu.contains(e.target)) close(false); };
        menu.classList.add('kanban-card-menu');
        menu.addEventListener('select', (e) => { e.stopPropagation(); run(state, e.detail); });
        menu.addEventListener('dismiss', state.dismiss);
        menu.addEventListener('contextmenu', (e) => e.preventDefault());
        document.body.appendChild(menu);
        open = state;
        show(state, 'main');
        document.addEventListener('pointerdown', state.outside, true);
        window.addEventListener('scroll', state.onScroll, true);
        window.addEventListener('resize', state.dismiss);
        window.addEventListener('blur', state.dismiss);
    }

    root.KanbanCardMenu = { open: openMenu, close, isOpen: () => !!open };
})(typeof globalThis !== 'undefined' ? globalThis : this);
