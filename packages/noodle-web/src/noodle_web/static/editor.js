/**
 * editor.js — Editor setup, syntax highlighting, line numbers, drag-drop.
 * Depends on: state.js (globals)
 */

function initializeEditor() {
    const editor = document.getElementById('planEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    const highlightLayer = document.getElementById('highlightLayer');

    if (!editor || !lineNumbers) {
        console.error('Editor or line numbers not found');
        return;
    }

    setupEditor(editor, lineNumbers, highlightLayer, true);
}

function initializeKanbanEditor() {
    const editor = document.getElementById('kanbanPlanEditor');
    const lineNumbers = document.getElementById('kanbanLineNumbers');
    const highlightLayer = document.getElementById('kanbanHighlightLayer');

    if (!editor || !lineNumbers) {
        console.error('Kanban editor or line numbers not found');
        return;
    }

    setupEditor(editor, lineNumbers, highlightLayer, false);
}

function getBackMatterFoldingDescriptors() {
    if (typeof SectionFolding === 'undefined') return [];
    return [
        { startMarker: HIGHLIGHTS_START, label: 'Highlights', endMarkers: [HIGHLIGHTS_END], countRows: SectionFolding.countHighlightEntries, countNoun: 'entry' },
        { startMarker: BUDGET_START, label: 'Budget', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: BENEFITS_START, label: 'Benefits', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: RAID_LOG_START, label: 'RAID log', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: COMMS_START, label: 'Comms', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: LESSONS_START, label: 'Lessons learned', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: BASELINE_START, label: 'Baseline', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: WHITEBOARD_START, label: 'Whiteboard', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: PARKING_LOT_START, label: 'Parking lot', countRows: SectionFolding.countMarkdownTableRows },
        { startMarker: ESTIMATES_START, label: 'Estimates', countRows: SectionFolding.countMarkdownTableRows },
    ];
}

function setupEditor(editor, lineNumbers, highlightLayer, shouldRender) {

    const sectionFoldingController = editor.id === 'planEditor' && typeof SectionFolding !== 'undefined'
        ? SectionFolding.attach({
            editor: editor,
            lineNumbers: lineNumbers,
            highlightLayer: highlightLayer,
            editorArea: editor.parentElement,
            descriptors: getBackMatterFoldingDescriptors(),
            storageNamespace: 'back-matter',
            getProjectId: () => (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default',
        })
        : null;

    // Syntax highlighting function
    function highlightSyntax(text) {
        // Build a set of all task names for dependency validation
        const allTaskNames = new Set();
        const allLines = text.split('\n');
        const foldingProjection = sectionFoldingController ? sectionFoldingController.getProjection() : null;
        const managedRawSections = foldingProjection ? foldingProjection.rawLineSections : null;
        let inFrontMatter = false;
        let inHighlights = false;
        let inRaidLog = false;
        let inBaseline = false;
        let inBudget = false;
        let inWhiteboard = false;
        for (let i = 0; i < allLines.length; i++) {
            const trimmed = allLines[i].trim();
            if (managedRawSections && managedRawSections[i]) continue;
            if (trimmed === '---') {
                inFrontMatter = !inFrontMatter;
                continue;
            }
            if (trimmed === '---highlights---') { inHighlights = true; continue; }
            if (trimmed === '---end-highlights---' || (inHighlights && (trimmed === '---raid log---' || trimmed === '---budget---'))) { inHighlights = false; }
            if (trimmed === '---budget---') { inBudget = true; continue; }
            if (inBudget && (trimmed === '---raid log---')) { inBudget = false; }
            if (trimmed === '---raid log---') { inRaidLog = true; continue; }
            if (trimmed === '---baseline---') { inBaseline = true; continue; }
            if (trimmed === '---whiteboard---') { inWhiteboard = true; continue; }
            if (inFrontMatter || inHighlights || inRaidLog || inBaseline || inBudget || inWhiteboard || !trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.includes('===')) continue;

            const taskMetadata = TaskLineTokenizer.metadata(allLines[i]).values;
            if (taskMetadata.name) {
                allTaskNames.add(taskMetadata.name.toLowerCase());
                if (taskMetadata.name.includes('_')) allTaskNames.add(taskMetadata.name.replace(/_/g, ' ').toLowerCase());
                if (taskMetadata.name.includes(' ')) allTaskNames.add(taskMetadata.name.replace(/ /g, '_').toLowerCase());
            }
            if (taskMetadata.deliverable) {
                const prefix = taskMetadata.product_type === 'group' ? '/$'
                    : taskMetadata.product_type === 'external' ? '^$' : '$';
                allTaskNames.add((prefix + taskMetadata.deliverable).toLowerCase());
                allTaskNames.add(taskMetadata.deliverable.toLowerCase());
            }
            continue;

            // Legacy name extraction retained temporarily below for source-history clarity.
            let taskText = trimmed;
            // Strip * prefix
            if (taskText.startsWith('*')) {
                taskText = taskText.substring(1).trim();
                // Strip optional lag/lead after *
                taskText = taskText.replace(/^[+\-]\d+[dwmy]\s+/, '');
            }
            // Remove comments in quotes (strip all quoted strings, and leading !)
            // Supports straight quotes "...", curly/smart quotes \u201c...\u201d, and mixed
            taskText = taskText.replace(/!?["\u201c][^"\u201d]*["\u201d]/g, '').trim();
            // Remove [depends ...] blocks
            taskText = taskText.replace(/\[depends(?::\s*|\s+)[^\]]+\]/gi, '').trim();
            // Remove bucket names in curly braces
            taskText = taskText.replace(/\{[^}]+\}/g, '').trim();
            // Remove priority markers
            taskText = taskText.replace(/(?<!\w)(!!!|!!|!)(?!["'{])/g, '').trim();
            // Extract name tokens (everything that's not a duration, resource, date, percent, or label)
            const tokens = taskText.split(/\s+/);
            const nameTokens = [];
            for (const token of tokens) {
                if (!token) continue;
                if (token.startsWith('@')) continue;       // resource
                if (token.startsWith('#')) continue;       // label
                if (/^[/^]?\$/.test(token)) {
                    // Deliverable token — add it as a valid dependency target
                    // Store both with and without the prefix: $GW2, GW2
                    allTaskNames.add(token.toLowerCase());
                    const stripped = token.replace(/^[/^]?\$/, '');
                    if (stripped) allTaskNames.add(stripped.toLowerCase());
                    continue;
                }
                if (/^\d+[dmwy]$/.test(token)) continue;  // duration
                if (/^\d+%$/.test(token)) continue;        // percent
                if (/^\d{4}-\d{2}-\d{2}$/.test(token)) continue; // date
                nameTokens.push(token);
            }
            const name = nameTokens.join(' ');
            if (name) {
                allTaskNames.add(name.toLowerCase());
                // Also add underscore variant so deps using either form match
                if (name.includes('_')) allTaskNames.add(name.replace(/_/g, ' ').toLowerCase());
                if (name.includes(' ')) allTaskNames.add(name.replace(/ /g, '_').toLowerCase());
            }
        }

        let inFrontMatterSection = false;
        let inHighlightsSection = false;
        let inBudgetSection = false;
        let inRaidLogSection = false;
        let inBaselineSection = false;
        let inWhiteboardSection = false;
        let inParkingLotSection = false;
        // Dependency tokens the last parse flagged as circular, keyed by
        // 1-based line number (see updateCircularDependencyWarnings).
        const circularByLine = window._circularDependencyLines || {};
        function escapeSyntaxHtml(value) {
            return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function highlightTaskLine(line, lineIdx) {
            const classByType = {
                star: 'syntax-star', 'star-lag': 'syntax-lag-lead', effort: 'syntax-effort',
                comment: 'syntax-comment', recurrence: 'syntax-recurrence', bucket: 'syntax-bucket',
                priority: 'syntax-priority', resource: 'syntax-resource', label: 'syntax-label',
                duration: 'syntax-duration', percent: 'syntax-percent', date: 'syntax-date',
                deadline: 'syntax-deadline', product: 'syntax-product'
            };
            const tokens = TaskLineTokenizer.tokenize(line);
            let output = '';
            let cursor = 0;
            for (const token of tokens) {
                if (token.start < cursor) continue;
                output += escapeSyntaxHtml(line.slice(cursor, token.start)).replace(/,/g,
                    '<span class="syntax-error" title="Commas in task names break dependency parsing">,</span>');
                if (token.type === 'dependency') {
                    const content = token.text.replace(/^\[depends(?::\s*|\s+)|\]$/gi, '');
                    const parts = content.split(',').map(part => {
                        const dependency = part.trim();
                        const lagMatch = /^(.+?)\s+([+\-]\d+[dwmy])$/.exec(dependency);
                        const core = (lagMatch ? lagMatch[1] : dependency).trim();
                        const typeMatch = /^(.+?):(FS|SS|FF|SF)$/i.exec(core);
                        const name = (typeMatch ? typeMatch[1] : core).trim().replace(/^Milestone:\s*/i, '');
                        const normalised = name.toLowerCase().replace(/\s+/g, ' ');
                        const circular = circularByLine[lineIdx + 1];
                        const valid = allTaskNames.has(normalised) ||
                            allTaskNames.has(normalised.replace(/_/g, ' ')) ||
                            allTaskNames.has(normalised.replace(/ /g, '_')) ||
                            allTaskNames.has(normalised.replace(/^[/^]?\$/, ''));
                        const nameHtml = circular && circular.has(normalised)
                            ? '<span class="syntax-circular" title="Circular dependency">' + escapeSyntaxHtml(name) + '</span>'
                            : valid ? escapeSyntaxHtml(name) : '<span class="syntax-error">' + escapeSyntaxHtml(name) + '</span>';
                        return nameHtml + (typeMatch ? '<span class="syntax-dep-type">:' + typeMatch[2].toUpperCase() + '</span>' : '') +
                            (lagMatch ? ' <span class="syntax-lag-lead">' + lagMatch[2] + '</span>' : '');
                    });
                    output += '<span class="syntax-dependency">[depends ' + parts.join(', ') + ']</span>';
                } else {
                    let className = classByType[token.type];
                    if (token.type === 'product') {
                        className += token.text[0] === '/' ? ' syntax-product-group'
                            : token.text[0] === '^' ? ' syntax-product-external' : '';
                    }
                    output += '<span class="' + className + '">' + escapeSyntaxHtml(token.text) + '</span>';
                }
                cursor = token.end;
            }
            return output + escapeSyntaxHtml(line.slice(cursor)).replace(/,/g,
                '<span class="syntax-error" title="Commas in task names break dependency parsing">,</span>');
        }
        const displayLines = foldingProjection ? foldingProjection.displayLines : allLines.map((line, lineIdx) => ({
            kind: 'raw',
            text: line,
            rawLineNumber: lineIdx + 1,
            sectionMarker: null,
        }));

        return displayLines.map((record, visibleIdx) => {
            const line = record.text;
            const lineIdx = (record.rawLineNumber || (visibleIdx + 1)) - 1;
            if (record.kind === 'header') {
                return '<span class="section-fold-highlight-line">&#8203;</span>';
            }
            if (record.sectionMarker) {
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }

            // Track front matter (between --- delimiters) — skip syntax highlighting
            if (line.trim() === '---' && !inHighlightsSection && !inBudgetSection && !inRaidLogSection && !inBaselineSection) {
                inFrontMatterSection = !inFrontMatterSection;
                return '<span class="syntax-frontmatter-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inFrontMatterSection) {
                const escaped = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const listMatch = escaped.match(/^(\s*-\s+)(.*)$/);
                if (listMatch) {
                    const prefix = '<span class="syntax-yaml-list">' + listMatch[1] + '</span>';
                    const rest = listMatch[2];
                    const restHighlighted = rest.replace(/@(\w+)/g, '<span class="syntax-resource">@$1</span>');
                    return prefix + '<span class="syntax-yaml-value">' + restHighlighted + '</span>';
                }
                const kvMatch = escaped.match(/^(\s*)([^:]+?)(:)(\s*)(.*)?$/);
                if (kvMatch) {
                    const indent = kvMatch[1] || '';
                    const key = kvMatch[2];
                    const colon = kvMatch[3];
                    const space = kvMatch[4] || '';
                    const value = kvMatch[5] || '';
                    return indent + '<span class="syntax-yaml-key">' + key + '</span>' +
                        '<span class="syntax-yaml-colon">' + colon + '</span>' + space +
                        '<span class="syntax-yaml-value">' + value + '</span>';
                }
                return '<span class="syntax-frontmatter">' + escaped + '</span>';
            }

            if (line.trim() === '---highlights---') {
                inHighlightsSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---end-highlights---' || (inHighlightsSection && (line.trim() === '---raid log---' || line.trim() === '---budget---'))) {
                inHighlightsSection = false;
                if (line.trim() === '---budget---') {
                    inBudgetSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                if (line.trim() === '---raid log---') {
                    inRaidLogSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inHighlightsSection) {
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---budget---') {
                inBudgetSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inBudgetSection) {
                if (line.trim() === '---raid log---') {
                    inBudgetSection = false;
                    inRaidLogSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                if (line.trim() === '---baseline---') {
                    inBudgetSection = false;
                    inBaselineSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---raid log---') {
                inRaidLogSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inRaidLogSection) {
                if (line.trim() === '---baseline---') {
                    inRaidLogSection = false;
                    inBaselineSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---baseline---') {
                inBaselineSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inBaselineSection) {
                if (line.trim() === '---whiteboard---') {
                    inBaselineSection = false;
                    inWhiteboardSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---whiteboard---') {
                inWhiteboardSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inWhiteboardSection) {
                if (line.trim() === '---parking lot---') {
                    inWhiteboardSection = false;
                    inParkingLotSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---parking lot---') {
                inParkingLotSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (inParkingLotSection) {
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trimStart().startsWith('//')) {
                return '<span class="syntax-line-comment">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (!line.trim() || line.includes('===') || line.includes('---')) {
                return line;
            }
            return highlightTaskLine(line, lineIdx);
        }).join('\n');
    }

    // Update line numbers and syntax highlighting
    // Inner wrapper for line numbers — positioned via CSS top for scroll sync
    function updateLineNumbers() {
        const content = editor.value || editor.placeholder || '';
        const displayProjection = sectionFoldingController ? sectionFoldingController.getProjection() : null;
        const displayLines = displayProjection ? displayProjection.displayLines : content.split('\n').map((line, index) => ({
            kind: 'raw',
            text: line,
            rawLineNumber: index + 1,
            sectionMarker: null,
        }));

        lineNumbers.innerHTML = '';
        const circularLines = window._circularDependencyLines || {};
        for (let i = 1; i <= displayLines.length; i++) {
            const record = displayLines[i - 1];
            const rawLineNumber = record.rawLineNumber || i;
            const lineNumSpan = document.createElement('div');
            lineNumSpan.className = 'line-number';
            lineNumSpan.dataset.lineNumber = rawLineNumber;
            lineNumSpan.dataset.visibleLine = i;

            if (record.kind === 'header') {
                lineNumSpan.classList.add('section-fold-gutter-line');
                lineNumSpan.dataset.foldHeader = 'true';
                lineNumSpan.title = record.summary;
            }

            if (circularLines[rawLineNumber]) {
                lineNumSpan.classList.add('circular-dependency');
                lineNumSpan.title = 'Circular dependency on this line';
            }

            const isManuallyScheduled = record.kind === 'raw' && isLineManuallyScheduled(record.text);
            if (isManuallyScheduled) {
                lineNumSpan.classList.add('manually-scheduled');
                lineNumSpan.title = 'Manually scheduled (has explicit start date)';
                const pinIcon = document.createElement('span');
                pinIcon.className = 'pin-icon';
                lineNumSpan.appendChild(pinIcon);
            }

            const lineNumText = document.createElement('span');
            lineNumText.textContent = rawLineNumber;
            lineNumSpan.appendChild(lineNumText);
            lineNumbers.appendChild(lineNumSpan);
        }

        if (highlightLayer) {
            highlightLayer.innerHTML = highlightSyntax(content);
        }

        if (sectionFoldingController) sectionFoldingController.renderOverlay();
        syncScroll();
        updateActiveLine();
    }

    // Helper function to detect if a task line is manually scheduled (has explicit start date)
    function isLineManuallyScheduled(line) {
        if (!line || !line.trim()) return false;

        // Skip front matter
        if (line.trim() === '---') return false;

        // Skip comments and empty lines
        if (line.trim().startsWith('#') || !line.trim()) return false;

        // Check if line contains a date in YYYY-MM-DD format
        // This indicates an explicit start date, making it manually scheduled
        const datePattern = /\d{4}-\d{2}-\d{2}/;
        return datePattern.test(line);
    }

    // Update the active line indicator
    function updateActiveLine() {
        const visibleText = sectionFoldingController ? sectionFoldingController.getDisplayText() : editor.value;
        const cursorPosition = sectionFoldingController
            ? SectionFolding.getVisibleSelectionStart(editor)
            : editor.selectionStart;
        const currentLine = sectionFoldingController
            ? SectionFolding.visibleLineFromVisibleOffset(visibleText, cursorPosition)
            : visibleText.substring(0, cursorPosition).split('\n').length;

        const allLineNumbers = lineNumbers.querySelectorAll('.line-number');
        allLineNumbers.forEach(ln => ln.classList.remove('active'));

        const selector = sectionFoldingController
            ? `[data-visible-line="${currentLine}"]`
            : `[data-line-number="${currentLine}"]`;
        const activeLineElement = lineNumbers.querySelector(selector);
        if (activeLineElement) {
            activeLineElement.classList.add('active');
        }
    }

    // Sync scroll between textarea, line numbers, and highlight overlay.
    // Uses CSS top/left offset instead of scrollTop to avoid line-height
    // drift between textarea and div text rendering.
    function syncScroll() {
        if (highlightLayer) {
            highlightLayer.style.top = -editor.scrollTop + 'px';
            highlightLayer.style.left = -editor.scrollLeft + 'px';
        }
        if (sectionFoldingController && sectionFoldingController.overlay) {
            sectionFoldingController.overlay.style.transform = 'translate(' + (-editor.scrollLeft) + 'px, ' + (-editor.scrollTop) + 'px)';
        }
        lineNumbers.scrollTop = editor.scrollTop;
    }

    // Expose updateLineNumbers on the editor element so external code can call it
    editor._updateLineNumbers = updateLineNumbers;

    // Initialize
    updateLineNumbers();

    // Debounce timer for render requests
    let renderDebounceTimer = null;

    // Debounce timer for front-matter panel resync (#780)
    let fmPanelSyncTimer = null;

    // Debounce timer for back-matter panel resync (#1203)
    let bmPanelSyncTimer = null;

    // Update on input and auto-render with debounce (only for main editor)
    editor.addEventListener('input', function() {
        // Quietly replace curly/smart quotes with straight quotes
        if (/[\u201c\u201d\u2018\u2019]/.test(editor.value)) {
            const pos = editor.selectionStart;
            editor.value = editor.value
                .replace(/[\u201c\u201d]/g, '"')
                .replace(/[\u2018\u2019]/g, "'");
            editor.selectionStart = editor.selectionEnd = pos;
        }

        // Build the authoritative task graph once for this text revision.
        // View/table operations reuse this cached model until the user edits
        // the markdown again.
        if (shouldRender && typeof NoodlePlanModel !== 'undefined') {
            NoodlePlanModel.modelForEditor(editor);
        }

        updateLineNumbers();

        // Only trigger auto-render for the main editor
        if (shouldRender) {
            // Clear previous timer if it exists
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
            }

            // Record undo snapshot (debounced) for the main editor
            if (typeof EditorUndoManager !== 'undefined') {
                EditorUndoManager.scheduleSnapshot(editor.value);
            }

            // Auto-render after 1 second of inactivity
            renderDebounceTimer = setTimeout(() => {
                renderText();
                renderDebounceTimer = null;
            }, 1000);

            // Keep the front-matter panel (#780) in sync when the user
            // types the raw YAML directly into the textarea instead of
            // using the structured editor.
            if (editor._updateFrontMatterPanel) {
                if (fmPanelSyncTimer) clearTimeout(fmPanelSyncTimer);
                fmPanelSyncTimer = setTimeout(() => {
                    editor._updateFrontMatterPanel();
                    fmPanelSyncTimer = null;
                }, 500);
            }

            // Same as above for the back-matter panel (#1203): keep it in
            // sync when the user types raw markdown directly into the
            // textarea instead of using the panel's own raw editor.
            if (editor._updateBackMatterPanel) {
                if (bmPanelSyncTimer) clearTimeout(bmPanelSyncTimer);
                bmPanelSyncTimer = setTimeout(() => {
                    editor._updateBackMatterPanel();
                    bmPanelSyncTimer = null;
                }, 500);
            }
        }
    });

    // Expose a way to cancel a pending debounced auto-render (only ever set
    // for the main editor, shouldRender), the same convention as
    // editor._updateLineNumbers above. Callers that just performed their
    // own immediate render after programmatically changing editor.value and
    // dispatching 'input' (e.g. whiteboard-notes.js's wbCommitMarkdown())
    // use this to stop the render this same 'input' event just scheduled
    // above from *also* firing a second, redundant time a second later --
    // otherwise that second render tears down and rebuilds DOM the caller
    // already finished with (e.g. a freshly-focused input), undoing it.
    if (shouldRender) {
        editor._cancelPendingRender = function() {
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
                renderDebounceTimer = null;
            }
        };
    }

    // Sync scroll on all scroll-related events including touch momentum
    editor.addEventListener('scroll', syncScroll, { passive: true });
    editor.addEventListener('touchmove', syncScroll, { passive: true });

    // Track cursor position for active line indicator
    editor.addEventListener('click', updateActiveLine);
    editor.addEventListener('keyup', updateActiveLine);
    editor.addEventListener('focus', updateActiveLine);
    editor.addEventListener('touchend', updateActiveLine);

    // Keyboard shortcuts
    editor.addEventListener('keydown', function(e) {

        // Indent with Cmd+] (macOS) or Ctrl+] (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === ']') {
            e.preventDefault();
            indentSelectedLines();
        }

        // Outdent with Cmd+[ (macOS) or Ctrl+[ (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === '[') {
            e.preventDefault();
            outdentSelectedLines();
        }

        // Toggle comment with Ctrl+/ (or Cmd+/)
        if ((e.metaKey || e.ctrlKey) && e.key === '/') {
            e.preventDefault();
            toggleCommentLines();
        }
    });

    /**
     * Toggle // comment prefix on selected lines (or current line).
     */
    function toggleCommentLines() {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const text = editor.value;

        // Find the line range covered by the selection
        const lineStartIdx = text.lastIndexOf('\n', start - 1) + 1;
        let lineEndIdx = text.indexOf('\n', end);
        if (lineEndIdx === -1) lineEndIdx = text.length;

        const selectedText = text.substring(lineStartIdx, lineEndIdx);
        const lines = selectedText.split('\n');

        // Determine action: if ALL selected lines are commented, uncomment; otherwise comment
        const allCommented = lines.every(line => {
            const trimmed = line.trimStart();
            return trimmed === '' || trimmed.startsWith('// ') || trimmed.startsWith('//');
        });

        let newLines;
        if (allCommented) {
            // Uncomment: remove leading // (and optional space after)
            newLines = lines.map(line => {
                const idx = line.indexOf('//');
                if (idx === -1) return line;
                const after = line.substring(idx + 2);
                return line.substring(0, idx) + (after.startsWith(' ') ? after.substring(1) : after);
            });
        } else {
            // Comment: add // at the start of each line (preserving indentation)
            newLines = lines.map(line => {
                if (line.trim() === '') return line;
                const indent = line.match(/^(\s*)/)[1];
                const content = line.substring(indent.length);
                return indent + '// ' + content;
            });
        }

        const newText = newLines.join('\n');
        editor.value = text.substring(0, lineStartIdx) + newText + text.substring(lineEndIdx);

        // Restore selection to cover the modified lines
        editor.selectionStart = lineStartIdx;
        editor.selectionEnd = lineStartIdx + newText.length;

        // Fire input event
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Capture undo snapshot
        if (typeof EditorUndoManager !== 'undefined') {
            EditorUndoManager.captureImmediate(editor.value);
        }
    }

    // Long-press on line numbers to open task form (mobile support)
    let longPressTimer = null;
    let longPressLineNumber = null;

    lineNumbers.addEventListener('touchstart', function(e) {
        const target = e.target.closest('.line-number');
        if (!target) return;

        if (target.dataset.foldHeader === 'true') return;
        longPressLineNumber = parseInt(target.dataset.lineNumber);
        longPressTimer = setTimeout(() => {
            if (typeof openTaskForm === 'function') {
                openTaskForm(longPressLineNumber);
            }
        }, 500); // 500ms long press
    });

    lineNumbers.addEventListener('touchend', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    lineNumbers.addEventListener('touchmove', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

/**
 * Indent selected lines in the editor by 2 spaces
 */
function indentSelectedLines() {
    // Get the currently focused editor (main or kanban)
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    const editor = (kanbanEditor && document.activeElement === kanbanEditor) ? kanbanEditor : mainEditor;
    if (!editor) return;

    if (editor === mainEditor && typeof NoodlePlanModel !== 'undefined') {
        const startLine = editor.value.slice(0, editor.selectionStart).split('\n').length;
        const endLine = editor.value.slice(0, editor.selectionEnd).split('\n').length;
        const model = NoodlePlanModel.modelForEditor(editor);
        const selected = model.tasks.filter(task => {
            const line = model.lineNumber(task);
            return line >= startLine && line <= endLine;
        });
        if (model.indentTasks(selected)) {
            NoodlePlanModel.commitToEditor(editor, model);
            return;
        }
    }

    // Capture undo snapshot before the change
    if (editor === mainEditor && typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.captureImmediate(editor.value);
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // Find the start of the first selected line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the last selected line
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    // Extract the selected lines
    const selectedText = text.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');

    // Indent each line by 2 spaces
    const indentedLines = lines.map(line => '  ' + line);
    const indentedText = indentedLines.join('\n');

    // Replace the selected text with indented version
    editor.value = text.substring(0, lineStart) + indentedText + text.substring(lineEnd);

    // Restore selection, adjusting for added spaces
    const newStart = start + 2; // First line gets 2 spaces
    const newEnd = end + (indentedLines.length * 2); // Each line gets 2 spaces
    editor.setSelectionRange(newStart, newEnd);

    // Trigger render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Outdent selected lines in the editor by up to 2 spaces
 */
function outdentSelectedLines() {
    // Get the currently focused editor (main or kanban)
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    const editor = (kanbanEditor && document.activeElement === kanbanEditor) ? kanbanEditor : mainEditor;
    if (!editor) return;

    if (editor === mainEditor && typeof NoodlePlanModel !== 'undefined') {
        const startLine = editor.value.slice(0, editor.selectionStart).split('\n').length;
        const endLine = editor.value.slice(0, editor.selectionEnd).split('\n').length;
        const model = NoodlePlanModel.modelForEditor(editor);
        const selected = model.tasks.filter(task => {
            const line = model.lineNumber(task);
            return line >= startLine && line <= endLine;
        });
        if (model.outdentTasks(selected)) {
            NoodlePlanModel.commitToEditor(editor, model);
            return;
        }
    }

    // Capture undo snapshot before the change
    if (editor === mainEditor && typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.captureImmediate(editor.value);
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // Find the start of the first selected line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the last selected line
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    // Extract the selected lines
    const selectedText = text.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');

    // Outdent each line by up to 2 spaces
    const outdentedLines = lines.map(line => {
        // Remove up to 2 leading spaces
        if (line.startsWith('  ')) {
            return line.substring(2);
        } else if (line.startsWith(' ')) {
            return line.substring(1);
        }
        return line;
    });
    const outdentedText = outdentedLines.join('\n');

    // Calculate how many characters were removed
    const removedChars = selectedText.length - outdentedText.length;

    // Replace the selected text with outdented version
    editor.value = text.substring(0, lineStart) + outdentedText + text.substring(lineEnd);

    // Restore selection, adjusting for removed spaces
    const charsRemovedBeforeStart = Math.min(2, selectedText.substring(0, start - lineStart).match(/^ */)[0].length);
    const newStart = Math.max(lineStart, start - charsRemovedBeforeStart);
    const newEnd = Math.max(newStart, end - removedChars);
    editor.setSelectionRange(newStart, newEnd);

    // Trigger render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Extract the task name from a single editor line.
 * Returns empty string if the line is not a task (blank, header, separator, etc.)
 */
function extractTaskNameFromEditorLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.includes('===') || trimmed.includes('---')) {
        return '';
    }
    const task = parseTaskLine(line, 0);
    return task.name ? task.name.trim() : '';
}

/**
 * Add or replace a [depends TaskName] tag on a line.
 * If the line already has a [depends ...] block, the new dependency is appended.
 */
function addDependencyToLine(line, dependencyName) {
    const dependsPattern = /\[depends(?::\s*|\s+)([^\]]+)\]/i;
    const existingMatch = line.match(dependsPattern);

    if (existingMatch) {
        const existingDeps = existingMatch[1].split(',').map(d => d.trim());
        if (!existingDeps.some(d => d === dependencyName || d.startsWith(dependencyName + ' '))) {
            const updatedDeps = existingDeps.concat(dependencyName).join(', ');
            return line.replace(dependsPattern, '[depends ' + updatedDeps + ']');
        }
        return line; // Already has this dependency
    }

    return line.trimEnd() + ' [depends ' + dependencyName + ']';
}

/**
 * Add a dependency to a line using the * prefix approach.
 * Prepends * before the task name to indicate dependency on the previous task.
 */
function addStarDependencyToLine(line) {
    const indent = line.match(/^\s*/)[0];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('*')) {
        return line; // Already has * prefix
    }
    return indent + '*' + trimmed;
}

/**
 * Check whether a task line already has any dependency
 * (either a * prefix or a [depends ...] block).
 */
function lineHasDependency(line) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('*')) return true;
    if (/\[depends(?::\s*|\s+)[^\]]+\]/i.test(line)) return true;
    return false;
}

/**
 * Link selected tasks as a dependency chain from top to bottom.
 * Each task becomes dependent on the task above it in the selection.
 */
function linkSelectedTasks() {
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    const editor = (kanbanEditor && document.activeElement === kanbanEditor) ? kanbanEditor : mainEditor;
    if (!editor) return;

    // Capture undo snapshot before the change
    if (editor === mainEditor && typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.captureImmediate(editor.value);
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // Find the start of the first selected line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the last selected line
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    const selectedText = text.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');

    // Extract task names and filter to valid task lines
    const taskEntries = [];
    for (let i = 0; i < lines.length; i++) {
        const name = extractTaskNameFromEditorLine(lines[i]);
        if (name) {
            taskEntries.push({ index: i, name: name });
        }
    }

    // Need at least 2 tasks to create a chain
    if (taskEntries.length < 2) return;

    // Chain each task to depend on the previous one.
    // Use * prefix when the task has no existing dependencies (single dep).
    // Use [depends taskname] when the task already has dependencies (multiple deps).
    for (let i = 1; i < taskEntries.length; i++) {
        const prevTaskName = taskEntries[i - 1].name;
        const lineIndex = taskEntries[i].index;
        if (lineHasDependency(lines[lineIndex])) {
            lines[lineIndex] = addDependencyToLine(lines[lineIndex], prevTaskName);
        } else {
            lines[lineIndex] = addStarDependencyToLine(lines[lineIndex]);
        }
    }

    const updatedText = lines.join('\n');
    editor.value = text.substring(0, lineStart) + updatedText + text.substring(lineEnd);

    // Restore selection to cover the modified lines
    editor.setSelectionRange(lineStart, lineStart + updatedText.length);

    // Trigger render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function initializeUploadTab() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');

    if (!dropZone || !fileInput || !uploadBtn) {
        console.error('Upload elements not found');
        return;
    }

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
}

function initializeEditorDragDrop() {
    const editorPanel = document.querySelector('.editor-panel');
    const editorWrapper = document.querySelector('.editor-wrapper');
    const planEditor = document.getElementById('planEditor');

    if (!editorPanel || !editorWrapper || !planEditor) {
        console.error('Editor drag drop elements not found');
        return;
    }

    // Add drag over event to the editor panel
    editorPanel.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editorPanel.classList.add('drag-over');
    });

    // Remove drag over styling when leaving
    editorPanel.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only remove if we're actually leaving the editor panel
        if (!editorPanel.contains(e.relatedTarget)) {
            editorPanel.classList.remove('drag-over');
        }
    });

    // Handle file drop
    editorPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editorPanel.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];

            // Check if it's a supported file type
            if (!file.name.match(/\.(md|txt|xlsx|xls)$/i)) {
                showMessage('editor', 'error', 'Please drop Markdown (.md), text (.txt), or Excel (.xlsx) files');
                return;
            }

            if (file.size > 1048576) {
                showMessage('editor', 'error', 'File size must be less than 1MB');
                return;
            }

            // Excel files go through the import wizard
            if (file.name.match(/\.(xlsx|xls)$/i)) {
                openExcelImportWizard(file);
                return;
            }

            handleEditorFileDrop(file);
        }
    });
}

async function handleEditorFileDrop(file) {
    try {
        // Clear existing plan data
        const planEditor = document.getElementById('planEditor');
        if (!planEditor) return;

        // Clear RAID log entries and highlights BEFORE loading new plan
        clearPlanTrackingData();

        // Read the file content
        const text = await file.text();

        // Save current project before creating a new one
        saveCurrentProjectState();

        // Create a new project from the uploaded file
        const projectName = file.name.replace(/\.(md|txt|markdown)$/i, '');
        const project = createProject(projectName);
        saveProject(project.id, { planText: text });
        setCurrentProjectId(project.id);

        // Load content into editor
        planEditor.value = text;

        // Trigger input event to update line numbers and syntax highlighting
        planEditor.dispatchEvent(new Event('input'));

        // Update kanban editor too
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = text;
        }

        // Refresh project selectors
        if (typeof refreshProjectSelectors === 'function') {
            refreshProjectSelectors();
        }

        // Show success message
        showMessage('editor', 'success', `Created project "${project.name}" from ${file.name}`);

        // Auto-render the plan
        await renderText();

        console.log(`Created project "${project.name}" from ${file.name}`);

    } catch (error) {
        console.error('Error loading file:', error);
        showMessage('editor', 'error', 'Failed to load file: ' + error.message);
    }
}

function initializeKanbanEditorDragDrop() {
    const kanbanEditorPanel = document.getElementById('kanbanEditorPanel');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');

    if (!kanbanEditorPanel || !kanbanEditor) {
        return;
    }

    kanbanEditorPanel.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        kanbanEditorPanel.classList.add('drag-over');
    });

    kanbanEditorPanel.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!kanbanEditorPanel.contains(e.relatedTarget)) {
            kanbanEditorPanel.classList.remove('drag-over');
        }
    });

    kanbanEditorPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        kanbanEditorPanel.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];

            if (!file.name.match(/\.(md|txt|xlsx|xls)$/i)) {
                showMessage('editor', 'error', 'Please drop Markdown (.md), text (.txt), or Excel (.xlsx) files');
                return;
            }

            if (file.size > 1048576) {
                showMessage('editor', 'error', 'File size must be less than 1MB');
                return;
            }

            if (file.name.match(/\.(xlsx|xls)$/i)) {
                openExcelImportWizard(file);
                return;
            }

            handleEditorFileDrop(file);
        }
    });
}
