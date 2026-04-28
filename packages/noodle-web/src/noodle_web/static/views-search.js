/**
 * views-search.js — Project-scoped search results view.
 *
 * Provides:
 *   - A small search input in the nav header (#navSearchInput) that routes to
 *     the dedicated search results view on input/submit.
 *   - A full-page Search view (#search-tab) with its own input, a debounced
 *     fetch against /api/search, and grouped result cards.
 *   - Clicking a result invokes the relevant openXxxForm() global with the
 *     ref payload returned by the backend.
 *
 * Depends on:
 *   - NavigationController (script.js) — view registry & navigateTo()
 *   - openTaskFormByName / openProductForm / openRaidForm / openCommsForm /
 *     openBudgetForm / openHighlightForm / openResourceForm / openBenefitForm
 */

(function () {
    'use strict';

    const DEBOUNCE_MS = 250;
    const MIN_QUERY_LEN = 1;

    // Display order + labels for grouped result rendering
    const TYPE_ORDER = [
        'task', 'product', 'risk', 'comms',
        'budget', 'highlight', 'resource', 'benefit',
    ];
    const TYPE_LABELS = {
        task: 'Tasks',
        product: 'Products',
        risk: 'RAID',
        comms: 'Comms',
        budget: 'Budget',
        highlight: 'Highlights',
        resource: 'Resources',
        benefit: 'Benefits',
    };

    let searchDebounceTimer = null;
    let lastQuery = '';
    let inFlightController = null;

    // ── DOM helpers ──────────────────────────────────────────────────────

    function getMainEditor() {
        return document.getElementById('planEditor');
    }

    function getCurrentProjectName() {
        const el = document.getElementById('projectBreadcrumbName');
        return (el && el.textContent) ? el.textContent.trim() : null;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function highlightMatches(text, query) {
        const safe = escapeHtml(text);
        if (!query) return safe;
        const q = escapeHtml(query);
        try {
            const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            return safe.replace(re, m => `<mark>${m}</mark>`);
        } catch (e) {
            return safe;
        }
    }

    // ── Networking ───────────────────────────────────────────────────────

    async function fetchSearch(query) {
        const editor = getMainEditor();
        const planText = editor ? editor.value : '';

        // Cancel any prior in-flight request
        if (inFlightController) {
            try { inFlightController.abort(); } catch (e) { /* noop */ }
        }
        inFlightController = new AbortController();

        const resp = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_text: planText,
                query: query,
                project_name: getCurrentProjectName(),
            }),
            signal: inFlightController.signal,
        });
        if (!resp.ok) {
            throw new Error(`Search failed: ${resp.status}`);
        }
        return resp.json();
    }

    // ── Result handlers ──────────────────────────────────────────────────

    function activateResult(type, ref) {
        ref = ref || {};
        switch (type) {
            case 'task':
                if (typeof openTaskFormByName === 'function' && ref.name) {
                    openTaskFormByName(ref.name);
                }
                break;
            case 'product': {
                if (typeof openProductForm !== 'function') return;
                // openProductForm expects a task object; find one by deliverable/name
                const tasks = (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks)
                    ? lastRenderedTasks : [];
                let task = null;
                if (ref.deliverable) {
                    task = tasks.find(t => t && t.deliverable === ref.deliverable) || null;
                }
                if (!task && ref.name) {
                    task = tasks.find(t => t && t.name === ref.name) || null;
                }
                if (!task) {
                    // Fall back to a minimal task object
                    task = { name: ref.name || ref.deliverable, deliverable: ref.deliverable || '' };
                }
                openProductForm(task);
                break;
            }
            case 'risk':
                if (typeof openRaidForm === 'function') {
                    openRaidForm(ref.id);
                }
                break;
            case 'comms':
                if (typeof openCommsForm === 'function') {
                    openCommsForm(ref.id);
                }
                break;
            case 'budget':
                if (typeof openBudgetForm === 'function') {
                    openBudgetForm(ref.id);
                }
                break;
            case 'highlight':
                if (typeof openHighlightForm === 'function') {
                    openHighlightForm(ref.index);
                }
                break;
            case 'resource':
                if (typeof openResourceForm === 'function') {
                    openResourceForm(ref.shortname);
                }
                break;
            case 'benefit':
                if (typeof openBenefitForm === 'function') {
                    openBenefitForm(ref.id);
                }
                break;
            default:
                console.warn('Unknown search result type:', type);
        }
    }

    // ── Rendering ────────────────────────────────────────────────────────

    function renderResults(query, results) {
        const empty = document.getElementById('searchViewEmpty');
        const container = document.getElementById('searchViewResults');
        const meta = document.getElementById('searchViewMeta');
        if (!container || !empty || !meta) return;

        container.innerHTML = '';

        if (!query) {
            empty.style.display = '';
            container.style.display = 'none';
            meta.textContent = '';
            return;
        }

        if (!results || results.length === 0) {
            empty.style.display = 'none';
            container.style.display = '';
            container.innerHTML = `
                <div class="search-view-empty">
                    <p>No results for &ldquo;${escapeHtml(query)}&rdquo;.</p>
                    <p class="search-view-empty-hint">Try a shorter query or different keywords.</p>
                </div>`;
            meta.textContent = '0 results';
            return;
        }

        empty.style.display = 'none';
        container.style.display = '';

        // Group by type
        const groups = {};
        results.forEach(r => {
            (groups[r.type] = groups[r.type] || []).push(r);
        });

        const orderedTypes = TYPE_ORDER.filter(t => groups[t] && groups[t].length > 0);
        // Append any unknown types last (defensive)
        Object.keys(groups).forEach(t => {
            if (!TYPE_ORDER.includes(t)) orderedTypes.push(t);
        });

        const fragments = [];
        orderedTypes.forEach(type => {
            const items = groups[type];
            const label = TYPE_LABELS[type] || (type.charAt(0).toUpperCase() + type.slice(1));
            const groupEl = document.createElement('section');
            groupEl.className = 'search-view-group';
            groupEl.setAttribute('data-type', type);

            const header = document.createElement('header');
            header.className = 'search-view-group-header';
            header.innerHTML = `
                <span>${escapeHtml(label)}</span>
                <span class="search-view-group-count">${items.length}</span>
            `;
            groupEl.appendChild(header);

            items.forEach((item, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'search-view-result';
                btn.setAttribute('data-type', type);
                btn.setAttribute('data-result-index', String(idx));
                btn.innerHTML = `
                    <span class="search-view-result-badge" data-type="${escapeHtml(type)}">${escapeHtml(item.label || type)}</span>
                    <span class="search-view-result-body">
                        <div class="search-view-result-title">${highlightMatches(item.title || '', query)}</div>
                        <div class="search-view-result-snippet">${highlightMatches(item.snippet || '', query)}</div>
                    </span>
                `;
                btn.addEventListener('click', () => activateResult(type, item.ref));
                groupEl.appendChild(btn);
            });

            fragments.push(groupEl);
        });

        fragments.forEach(f => container.appendChild(f));
        meta.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`;
    }

    // ── Search execution ─────────────────────────────────────────────────

    async function runSearch(query) {
        const meta = document.getElementById('searchViewMeta');
        if (meta) meta.textContent = 'Searching…';

        try {
            const data = await fetchSearch(query);
            renderResults(data.query || query, data.results || []);
        } catch (err) {
            if (err && err.name === 'AbortError') return; // superseded
            console.error('Search error:', err);
            const container = document.getElementById('searchViewResults');
            const empty = document.getElementById('searchViewEmpty');
            if (container && empty) {
                empty.style.display = 'none';
                container.style.display = '';
                container.innerHTML = `
                    <div class="search-view-empty">
                        <p>Search failed. Please try again.</p>
                    </div>`;
            }
            if (meta) meta.textContent = '';
        }
    }

    function scheduleSearch(query) {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const trimmed = (query || '').trim();
        lastQuery = trimmed;

        if (trimmed.length < MIN_QUERY_LEN) {
            renderResults('', []);
            return;
        }

        searchDebounceTimer = setTimeout(() => {
            // Only run if the value hasn't changed since scheduling
            if (lastQuery === trimmed) {
                runSearch(trimmed);
            }
        }, DEBOUNCE_MS);
    }

    // ── Public helpers (used from inline handlers) ───────────────────────

    function searchViewClear() {
        const viewInput = document.getElementById('searchViewInput');
        const navInput = document.getElementById('navSearchInput');
        const clearBtn = document.getElementById('searchViewClearBtn');
        if (viewInput) viewInput.value = '';
        if (navInput) navInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        renderResults('', []);
        if (viewInput) viewInput.focus();
    }
    window.searchViewClear = searchViewClear;

    function navigateToSearchView(initialQuery) {
        if (typeof NavigationController === 'undefined') return;
        NavigationController.navigateTo('search');
        const viewInput = document.getElementById('searchViewInput');
        if (viewInput) {
            if (typeof initialQuery === 'string') {
                viewInput.value = initialQuery;
            }
            // Defer focus until after the view becomes visible
            setTimeout(() => {
                viewInput.focus();
                // Move caret to end
                const v = viewInput.value;
                viewInput.value = '';
                viewInput.value = v;
            }, 60);
            scheduleSearch(viewInput.value);
        }
    }
    window.navigateToSearchView = navigateToSearchView;

    // ── Wiring ───────────────────────────────────────────────────────────

    function syncInputs(source, target) {
        if (target && target.value !== source.value) {
            target.value = source.value;
        }
    }

    function updateClearBtn() {
        const viewInput = document.getElementById('searchViewInput');
        const clearBtn = document.getElementById('searchViewClearBtn');
        if (!viewInput || !clearBtn) return;
        clearBtn.style.display = viewInput.value ? '' : 'none';
    }

    function init() {
        const navInput = document.getElementById('navSearchInput');
        const viewInput = document.getElementById('searchViewInput');

        if (navInput) {
            navInput.addEventListener('input', () => {
                if (typeof NavigationController !== 'undefined' &&
                    NavigationController.getCurrentView() !== 'search') {
                    NavigationController.navigateTo('search');
                }
                if (viewInput) syncInputs(navInput, viewInput);
                updateClearBtn();
                scheduleSearch(navInput.value);
            });
            navInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    navigateToSearchView(navInput.value);
                } else if (e.key === 'Escape') {
                    navInput.value = '';
                    if (viewInput) viewInput.value = '';
                    updateClearBtn();
                    renderResults('', []);
                }
            });
        }

        if (viewInput) {
            viewInput.addEventListener('input', () => {
                if (navInput) syncInputs(viewInput, navInput);
                updateClearBtn();
                scheduleSearch(viewInput.value);
            });
            viewInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchViewClear();
                }
            });
        }

        // Register the view with NavigationController.
        // It must be registered after script.js has defined NavigationController.
        if (typeof NavigationController !== 'undefined') {
            NavigationController.register('search', {
                activate() {
                    // Keep planTab "active" since search is project-scoped
                    if (typeof activateTabContent === 'function') {
                        activateTabContent('search');
                    } else {
                        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        const el = document.getElementById('search-tab');
                        if (el) el.classList.add('active');
                    }
                    if (typeof closeAllNavMenus === 'function') closeAllNavMenus();
                    if (typeof setActiveNavTab === 'function') setActiveNavTab('planTab');
                    // Hide the project subnav while in search view
                    const planSubnav = document.getElementById('planSubnav');
                    if (planSubnav) planSubnav.classList.remove('visible');
                    updateClearBtn();
                },
                deactivate() {},
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
