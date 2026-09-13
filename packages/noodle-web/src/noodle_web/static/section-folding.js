(function (global) {
    'use strict';

    const SF_STORAGE_PREFIX = 'noodleplanner_section_folding_';
    const sfControllers = new WeakMap();

    function sfNormaliseMarker(marker) {
        return String(marker || '').trim().toLowerCase();
    }

    function sfStorageKey(projectId, namespace) {
        return SF_STORAGE_PREFIX + (namespace || 'default') + '_' + (projectId || 'default');
    }

    function sfParseStoredState(raw) {
        const fallback = { defaultExpanded: false, overrides: {} };
        if (!raw) return fallback;
        try {
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return fallback;
            const overrides = {};
            if (data.overrides && typeof data.overrides === 'object') {
                Object.keys(data.overrides).forEach((key) => {
                    overrides[sfNormaliseMarker(key)] = !!data.overrides[key];
                });
            }
            return {
                defaultExpanded: data.defaultExpanded === true,
                overrides: overrides,
            };
        } catch (error) {
            return fallback;
        }
    }

    function sfCloneState(state) {
        return {
            defaultExpanded: !!(state && state.defaultExpanded),
            overrides: Object.assign({}, state && state.overrides ? state.overrides : {}),
        };
    }

    function sfIsExpanded(state, marker) {
        const normalised = sfNormaliseMarker(marker);
        if (state && state.overrides && Object.prototype.hasOwnProperty.call(state.overrides, normalised)) {
            return !!state.overrides[normalised];
        }
        return !!(state && state.defaultExpanded);
    }

    function sfSetExpanded(state, marker, expanded) {
        const next = sfCloneState(state);
        const normalised = sfNormaliseMarker(marker);
        if (expanded === next.defaultExpanded) {
            delete next.overrides[normalised];
        } else {
            next.overrides[normalised] = !!expanded;
        }
        return next;
    }

    function sfCountMarkdownTableRows(contentLines) {
        const lines = Array.isArray(contentLines) ? contentLines : [];
        let headerIndex = -1;
        let separatorIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = String(lines[i] || '').trim();
            if (!trimmed.includes('|')) continue;
            if (headerIndex === -1) {
                headerIndex = i;
                continue;
            }
            if (/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(trimmed.replace(/\\\|/g, 'X'))) {
                separatorIndex = i;
                break;
            }
        }
        if (separatorIndex === -1) return 0;
        let count = 0;
        for (let i = separatorIndex + 1; i < lines.length; i++) {
            const trimmed = String(lines[i] || '').trim();
            if (!trimmed || !trimmed.includes('|')) continue;
            if (/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(trimmed.replace(/\\\|/g, 'X'))) continue;
            count++;
        }
        return count;
    }

    function sfCountNonEmptyLines(contentLines) {
        return (Array.isArray(contentLines) ? contentLines : []).filter((line) => String(line || '').trim()).length;
    }

    function sfCountHighlightEntries(contentLines) {
        const lines = Array.isArray(contentLines) ? contentLines : [];
        let count = 0;
        for (const line of lines) {
            const trimmed = String(line || '').trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('# ')) continue;
            if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed) || /^##+\s+/.test(trimmed)) {
                count++;
                continue;
            }
            count++;
        }
        return count;
    }

    function sfFormatCount(count, singular) {
        const noun = singular || 'row';
        if (count === 1) return count + ' ' + noun;
        if (/[^aeiou]y$/i.test(noun)) return count + ' ' + noun.slice(0, -1) + 'ies';
        return count + ' ' + noun + 's';
    }

    function sfEscapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function sfLineStarts(text) {
        const starts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) starts.push(i + 1);
        }
        return starts;
    }

    function sfDescriptorMap(descriptors) {
        const map = new Map();
        (descriptors || []).forEach((descriptor) => {
            const normalised = sfNormaliseMarker(descriptor && descriptor.startMarker);
            if (!normalised) return;
            map.set(normalised, Object.assign({}, descriptor, {
                startMarker: descriptor.startMarker,
                _normalisedMarker: normalised,
                endMarkers: Array.isArray(descriptor.endMarkers) ? descriptor.endMarkers.slice() : [],
            }));
        });
        return map;
    }

    function sfCollectSectionInstances(text, descriptors) {
        const value = typeof text === 'string' ? text : '';
        const lines = value.split('\n');
        const lineStarts = sfLineStarts(value);
        const descriptorByMarker = sfDescriptorMap(descriptors);
        const starts = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const marker = sfNormaliseMarker(lines[lineIndex]);
            if (!descriptorByMarker.has(marker)) continue;
            starts.push({ descriptor: descriptorByMarker.get(marker), startLine: lineIndex, marker: marker });
        }

        const sections = [];
        starts.forEach((entry, index) => {
            const descriptor = entry.descriptor;
            const nextStartLine = index + 1 < starts.length ? starts[index + 1].startLine : lines.length;
            let endExclusiveLine = nextStartLine;
            let explicitEndLine = -1;
            if (descriptor.endMarkers && descriptor.endMarkers.length) {
                const endSet = new Set(descriptor.endMarkers.map(sfNormaliseMarker));
                for (let scan = entry.startLine + 1; scan < nextStartLine; scan++) {
                    if (endSet.has(sfNormaliseMarker(lines[scan]))) {
                        explicitEndLine = scan;
                        endExclusiveLine = scan + 1;
                        break;
                    }
                }
            }

            const rawStart = lineStarts[entry.startLine] || 0;
            const rawEnd = endExclusiveLine < lineStarts.length ? lineStarts[endExclusiveLine] : value.length;
            const markerLineEnd = entry.startLine + 1 < lineStarts.length ? lineStarts[entry.startLine + 1] : value.length;
            const contentStart = entry.startLine + 1;
            const contentEnd = explicitEndLine === -1 ? endExclusiveLine : explicitEndLine;
            const contentLines = lines.slice(contentStart, contentEnd);
            const count = typeof descriptor.countRows === 'function'
                ? descriptor.countRows(contentLines.slice(), {
                    marker: descriptor.startMarker,
                    startLine: entry.startLine + 1,
                    endLine: endExclusiveLine,
                    contentStartLine: contentStart + 1,
                    contentEndLine: contentEnd,
                })
                : sfCountNonEmptyLines(contentLines);
            const countNoun = descriptor.countNoun || 'row';
            const label = descriptor.label || descriptor.startMarker;
            const summary = typeof descriptor.summary === 'function'
                ? descriptor.summary({
                    label: label,
                    marker: descriptor.startMarker,
                    count: count,
                    countText: sfFormatCount(count, countNoun),
                    contentLines: contentLines.slice(),
                    startLine: entry.startLine + 1,
                    endLine: endExclusiveLine,
                })
                : label + ' (' + sfFormatCount(count, countNoun) + ')';

            sections.push({
                descriptor: descriptor,
                marker: descriptor.startMarker,
                normalisedMarker: descriptor._normalisedMarker,
                label: label,
                count: count,
                countText: sfFormatCount(count, countNoun),
                summary: summary,
                startLine: entry.startLine,
                endExclusiveLine: endExclusiveLine,
                contentStartLine: contentStart,
                contentEndLine: contentEnd,
                explicitEndLine: explicitEndLine,
                rawStart: rawStart,
                rawEnd: rawEnd,
                rawMarkerEnd: markerLineEnd,
                contentLines: contentLines,
                lines: lines.slice(entry.startLine, endExclusiveLine),
            });
        });

        const byStartLine = new Map();
        const byMarker = new Map();
        const rawLineSections = new Array(lines.length).fill(null);
        sections.forEach((section) => {
            byStartLine.set(section.startLine, section);
            byMarker.set(section.normalisedMarker, section);
            for (let line = section.startLine; line < section.endExclusiveLine; line++) {
                rawLineSections[line] = section.normalisedMarker;
            }
        });

        return {
            text: value,
            lines: lines,
            lineStarts: lineStarts,
            sections: sections,
            byStartLine: byStartLine,
            byMarker: byMarker,
            rawLineSections: rawLineSections,
        };
    }

    function sfLeadingFrontMatterEndLine(lines) {
        if (!lines.length || String(lines[0] || '').trim() !== '---') return 0;
        for (let line = 1; line < lines.length; line++) {
            if (String(lines[line] || '').trim() === '---') return line + 1;
        }
        return 0;
    }

    function sfBuildProjection(text, descriptors, state, options) {
        const collected = sfCollectSectionInstances(text, descriptors);
        const rawText = collected.text;
        const rawLines = collected.lines;
        const rawLineStarts = collected.lineStarts;
        const displayLines = [];
        const segments = [];
        const syntheticRanges = [];
        const visibleLineToSection = new Map();
        const foldingEnabled = !(options && options.disableSectionFolding);
        let visibleOffset = 0;
        const hideLeadingFrontMatter = !!(options && options.hideLeadingFrontMatter);
        let rawLineIndex = hideLeadingFrontMatter ? sfLeadingFrontMatterEndLine(rawLines) : 0;

        function pushDisplayLine(record) {
            const lineText = record.text;
            const start = visibleOffset;
            const end = start + lineText.length;
            displayLines.push(record);
            if (record.kind === 'raw') {
                segments.push({
                    kind: 'raw',
                    visibleStart: start,
                    visibleEnd: end,
                    rawStart: record.rawStart,
                    rawEnd: record.rawEnd,
                    rawLineNumber: record.rawLineNumber,
                });
            } else {
                const segment = {
                    kind: 'header',
                    marker: record.marker,
                    visibleStart: start,
                    visibleEnd: end,
                    rawStart: record.rawStart,
                    rawEnd: record.rawEnd,
                    rawCollapsedEnd: record.rawCollapsedEnd,
                    rawLineNumber: record.rawLineNumber,
                    expanded: !!record.expanded,
                    summary: record.summary,
                };
                segments.push(segment);
                syntheticRanges.push(segment);
                visibleLineToSection.set(displayLines.length, record.section);
            }
            visibleOffset = end + 1;
        }

        while (rawLineIndex < rawLines.length) {
            const section = foldingEnabled ? collected.byStartLine.get(rawLineIndex) : null;
            if (section) {
                const expanded = sfIsExpanded(state, section.marker);
                const markerLineText = section.summary;
                const markerRawStart = rawLineStarts[section.startLine] || 0;
                const markerRawEnd = section.startLine + 1 < rawLineStarts.length ? rawLineStarts[section.startLine + 1] : rawText.length;
                pushDisplayLine({
                    kind: 'header',
                    text: markerLineText,
                    marker: section.marker,
                    summary: section.summary,
                    rawStart: markerRawStart,
                    rawEnd: markerRawEnd,
                    rawCollapsedEnd: expanded ? markerRawEnd : section.rawEnd,
                    rawLineNumber: section.startLine + 1,
                    expanded: expanded,
                    section: section,
                });

                if (expanded) {
                    for (let line = section.startLine + 1; line < section.endExclusiveLine; line++) {
                        const rawStart = rawLineStarts[line] || 0;
                        const rawEnd = line + 1 < rawLineStarts.length ? rawLineStarts[line + 1] : rawText.length;
                        pushDisplayLine({
                            kind: 'raw',
                            text: rawLines[line],
                            rawStart: rawStart,
                            rawEnd: rawEnd,
                            rawLineNumber: line + 1,
                            sectionMarker: section.marker,
                        });
                    }
                }
                rawLineIndex = section.endExclusiveLine;
                continue;
            }

            const rawStart = rawLineStarts[rawLineIndex] || 0;
            const rawEnd = rawLineIndex + 1 < rawLineStarts.length ? rawLineStarts[rawLineIndex + 1] : rawText.length;
            pushDisplayLine({
                kind: 'raw',
                text: rawLines[rawLineIndex],
                rawStart: rawStart,
                rawEnd: rawEnd,
                rawLineNumber: rawLineIndex + 1,
                sectionMarker: null,
            });
            rawLineIndex++;
        }

        return {
            rawText: rawText,
            rawLines: rawLines,
            rawLineStarts: rawLineStarts,
            displayLines: displayLines,
            displayText: displayLines.map((line) => line.text).join('\n'),
            sections: foldingEnabled ? collected.sections.map((section) => Object.assign({}, section, {
                expanded: sfIsExpanded(state, section.marker),
            })) : [],
            rawLineSections: foldingEnabled ? collected.rawLineSections : new Array(rawLines.length).fill(null),
            segments: segments,
            syntheticRanges: syntheticRanges,
            visibleLineToSection: visibleLineToSection,
        };
    }

    function sfCommonDiff(beforeText, afterText) {
        let prefixLength = 0;
        const maxPrefix = Math.min(beforeText.length, afterText.length);
        while (prefixLength < maxPrefix && beforeText[prefixLength] === afterText[prefixLength]) {
            prefixLength++;
        }

        let suffixLength = 0;
        const maxSuffix = Math.min(beforeText.length - prefixLength, afterText.length - prefixLength);
        while (suffixLength < maxSuffix &&
            beforeText[beforeText.length - 1 - suffixLength] === afterText[afterText.length - 1 - suffixLength]) {
            suffixLength++;
        }

        return {
            prefixLength: prefixLength,
            oldEnd: beforeText.length - suffixLength,
            newEnd: afterText.length - suffixLength,
        };
    }

    function sfRangeTouchesSynthetic(projection, start, end) {
        const from = Math.min(start, end);
        const to = Math.max(start, end);
        for (const range of projection.syntheticRanges) {
            if (to === from) {
                if (from >= range.visibleStart && from <= range.visibleEnd) return range;
                continue;
            }
            if (from < range.visibleEnd && to > range.visibleStart) return range;
        }
        return null;
    }

    function sfRawOffsetFromVisibleOffset(projection, visibleOffset, bias) {
        const offset = Math.max(0, Math.min(visibleOffset, projection.displayText.length));
        for (const segment of projection.segments) {
            if (offset < segment.visibleStart) break;
            if (offset <= segment.visibleEnd) {
                if (segment.kind === 'raw') {
                    return segment.rawStart + (offset - segment.visibleStart);
                }
                return bias === 'end' ? segment.rawEnd : segment.rawStart;
            }
        }
        return projection.rawText.length;
    }

    function sfVisibleOffsetFromRawOffset(projection, rawOffset, bias) {
        const offset = Math.max(0, Math.min(rawOffset, projection.rawText.length));
        for (const segment of projection.segments) {
            if (segment.kind === 'raw') {
                // A structured front-matter view can hide a leading raw
                // range. Map a caret from that range to the first visible
                // position instead of jumping it to the end of the file.
                if (offset < segment.rawStart) return segment.visibleStart;
                if (offset <= segment.rawEnd) {
                    return segment.visibleStart + (offset - segment.rawStart);
                }
                continue;
            }
            if (offset >= segment.rawStart && offset <= segment.rawCollapsedEnd) {
                return bias === 'end' ? segment.visibleEnd : segment.visibleStart;
            }
        }
        return projection.displayText.length;
    }

    function sfVisibleLineFromRawLine(projection, rawLineNumber) {
        const target = Math.max(1, rawLineNumber | 0);
        for (let index = 0; index < projection.displayLines.length; index++) {
            const line = projection.displayLines[index];
            const section = line.kind === 'header' ? line.section : null;
            if (line.kind === 'header') {
                if (target >= section.startLine + 1 && target <= section.endExclusiveLine) return index + 1;
                continue;
            }
            if (line.rawLineNumber === target) return index + 1;
        }
        return Math.max(1, projection.displayLines.length);
    }

    function sfFindCollapsedSectionForRawLine(projection, rawLineNumber) {
        const target = Math.max(1, rawLineNumber | 0) - 1;
        for (const line of projection.displayLines) {
            if (line.kind !== 'header' || line.expanded) continue;
            const section = line.section;
            if (target >= section.startLine && target < section.endExclusiveLine) return section;
        }
        return null;
    }

    function sfApplyVisibleEdit(projection, newVisibleText, selectionHint) {
        const beforeText = projection.displayText;
        const afterText = typeof newVisibleText === 'string' ? newVisibleText : '';
        if (afterText === beforeText) {
            return { rawText: projection.rawText, diff: sfCommonDiff(beforeText, afterText), blocked: null };
        }
        let diff = sfCommonDiff(beforeText, afterText);

        // Repeated characters make a text-only diff ambiguous. In particular,
        // inserting a newline on the last task line can be reported at the
        // start of the following folded header because both sides already
        // contain a newline. The textarea's collapsed post-input selection
        // tells us where a pure insertion actually ended; prefer that exact
        // range when removing it recreates the previous projection.
        const insertedLength = afterText.length - beforeText.length;
        const hintedStart = selectionHint && selectionHint.selectionStart;
        const hintedEnd = selectionHint && selectionHint.selectionEnd;
        if (insertedLength > 0 && Number.isInteger(hintedStart) && hintedStart === hintedEnd) {
            const insertionStart = hintedStart - insertedLength;
            if (insertionStart >= 0 &&
                beforeText.slice(0, insertionStart) === afterText.slice(0, insertionStart) &&
                beforeText.slice(insertionStart) === afterText.slice(hintedStart)) {
                diff = {
                    prefixLength: insertionStart,
                    oldEnd: insertionStart,
                    newEnd: hintedStart,
                };
            }
        }
        const blocked = sfRangeTouchesSynthetic(projection, diff.prefixLength, diff.oldEnd);
        if (blocked) {
            return { rawText: projection.rawText, diff: diff, blocked: blocked };
        }
        const rawStart = sfRawOffsetFromVisibleOffset(projection, diff.prefixLength, 'start');
        const rawEnd = sfRawOffsetFromVisibleOffset(projection, diff.oldEnd, 'end');
        return {
            rawText: projection.rawText.slice(0, rawStart) + afterText.slice(diff.prefixLength, diff.newEnd) + projection.rawText.slice(rawEnd),
            diff: Object.assign(diff, { rawStart: rawStart, rawEnd: rawEnd }),
            blocked: null,
        };
    }

    function sfTranslateEditedVisibleOffset(projection, diff, newVisibleOffset) {
        const offset = Math.max(0, newVisibleOffset | 0);
        if (offset <= diff.prefixLength) {
            return sfRawOffsetFromVisibleOffset(projection, offset, 'start');
        }
        if (offset >= diff.newEnd) {
            const visibleTailOffset = diff.oldEnd + (offset - diff.newEnd);
            const rawTailOffset = sfRawOffsetFromVisibleOffset(projection, visibleTailOffset, 'end');
            const rawEditedEnd = diff.rawStart + (diff.newEnd - diff.prefixLength);
            return rawEditedEnd + (rawTailOffset - diff.rawEnd);
        }
        return diff.rawStart + (offset - diff.prefixLength);
    }

    function sfFindSectionStartLine(text, marker, descriptors) {
        const projection = sfBuildProjection(text, descriptors || [], { defaultExpanded: false, overrides: {} });
        const normalised = sfNormaliseMarker(marker);
        const section = projection.sections.find((item) => item.normalisedMarker === normalised);
        return section ? section.startLine + 1 : -1;
    }

    function sfFindTableRowLine(text, marker, rowId, descriptors) {
        const projection = sfBuildProjection(text, descriptors || [], { defaultExpanded: false, overrides: {} });
        const normalised = sfNormaliseMarker(marker);
        const section = projection.sections.find((item) => item.normalisedMarker === normalised);
        if (!section) return -1;
        const target = String(rowId == null ? '' : rowId).trim();
        if (!target) return section.startLine + 1;
        for (let line = section.contentStartLine; line < section.contentEndLine; line++) {
            const raw = projection.rawLines[line] || '';
            if (!raw.includes('|')) continue;
            if (raw.replace(/[|\-:\s]/g, '') === '') continue;
            const cells = raw.split(/(?<!\\)\|/)
                .map((cell) => cell.trim())
                .filter((cell, index, arr) => !(index === 0 && !cell) && !(index === arr.length - 1 && !cell));
            if (!cells.length) continue;
            if (cells[0].replace(/\\\|/g, '|') === target) return line + 1;
        }
        return section.startLine + 1;
    }

    function sfVisibleLineFromVisibleOffset(text, offset) {
        if (!text) return 1;
        const safe = Math.max(0, Math.min(offset, text.length));
        let count = 1;
        for (let i = 0; i < safe; i++) if (text.charCodeAt(i) === 10) count++;
        return count;
    }

    class SectionFoldingController {
        constructor(options) {
            this.editor = options.editor;
            this.lineNumbers = options.lineNumbers;
            this.highlightLayer = options.highlightLayer || null;
            this.editorArea = options.editorArea || (this.editor ? this.editor.parentElement : null);
            this.toolbar = null;
            this.overlay = null;
            this.descriptors = Array.isArray(options.descriptors) ? options.descriptors.slice() : [];
            this.storageNamespace = options.storageNamespace || 'default';
            this.getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : function () { return 'default'; };
            this.showToolbar = options.showToolbar !== false;
            this.projectId = null;
            this.state = { defaultExpanded: false, overrides: {} };
            this.hideLeadingFrontMatter = false;
            this.disableSectionFolding = false;
            this.projection = sfBuildProjection('', this.descriptors, this.state, {
                hideLeadingFrontMatter: this.hideLeadingFrontMatter,
                disableSectionFolding: this.disableSectionFolding,
            });

            const proto = Object.getPrototypeOf(this.editor);
            this.nativeValue = Object.getOwnPropertyDescriptor(proto, 'value');
            this.nativeSelectionStart = Object.getOwnPropertyDescriptor(proto, 'selectionStart');
            this.nativeSelectionEnd = Object.getOwnPropertyDescriptor(proto, 'selectionEnd');
            this.nativeSetSelectionRange = proto.setSelectionRange;

            this.installProxy();
            this.ensureUi();
            this.bindEvents();
            this.syncProjectState();
            this.setRawText(this.nativeValue.get.call(this.editor));
        }

        installProxy() {
            const controller = this;
            Object.defineProperty(this.editor, 'value', {
                configurable: true,
                get() {
                    return controller.getRawText();
                },
                set(nextValue) {
                    controller.setRawText(nextValue);
                },
            });
            Object.defineProperty(this.editor, 'selectionStart', {
                configurable: true,
                get() {
                    return controller.getRawSelectionStart();
                },
                set(nextValue) {
                    controller.setRawSelectionRange(nextValue, controller.getRawSelectionEnd());
                },
            });
            Object.defineProperty(this.editor, 'selectionEnd', {
                configurable: true,
                get() {
                    return controller.getRawSelectionEnd();
                },
                set(nextValue) {
                    controller.setRawSelectionRange(controller.getRawSelectionStart(), nextValue);
                },
            });
            this.editor.setSelectionRange = function (start, end, direction) {
                controller.setRawSelectionRange(start, end, direction);
            };
        }

        ensureUi() {
            if (this.showToolbar && this.editorArea && !this.toolbar) {
                const wrapper = this.editor.closest('.editor-panel') || this.editorArea.parentElement;
                const editorWrapper = this.editorArea.parentElement;
                if (wrapper && editorWrapper) {
                    const toolbar = document.createElement('div');
                    toolbar.className = 'section-fold-toolbar';
                    toolbar.innerHTML =
                        '<div class="section-fold-toolbar-group">' +
                        '<button type="button" class="section-fold-toolbar-btn" data-action="collapse-all">Collapse all back matter</button>' +
                        '<button type="button" class="section-fold-toolbar-btn" data-action="expand-all">Expand all back matter</button>' +
                        '</div>' +
                        '<label class="section-fold-toolbar-toggle">' +
                        '<input type="checkbox" data-action="default-expanded"> Expanded by default' +
                        '</label>';
                    toolbar.querySelector('[data-action="collapse-all"]').addEventListener('click', () => this.collapseAll());
                    toolbar.querySelector('[data-action="expand-all"]').addEventListener('click', () => this.expandAll());
                    toolbar.querySelector('[data-action="default-expanded"]').addEventListener('change', (event) => {
                        this.setDefaultExpanded(!!event.target.checked);
                    });
                    wrapper.insertBefore(toolbar, editorWrapper);
                    this.toolbar = toolbar;
                }
            }

            if (this.editorArea && !this.overlay) {
                const overlay = document.createElement('div');
                overlay.className = 'section-fold-overlay';
                this.editorArea.appendChild(overlay);
                this.overlay = overlay;
            }
        }

        bindEvents() {
            this.editor.addEventListener('beforeinput', (event) => {
                const selectionStart = this.getVisibleSelectionStart();
                const selectionEnd = this.getVisibleSelectionEnd();
                const blocked = sfRangeTouchesSynthetic(this.projection, selectionStart, selectionEnd);
                if (blocked) {
                    const section = this.findSectionByMarker(blocked.marker);
                    if (section) this.setExpanded(section.marker, true, { focus: true, rawLineNumber: section.startLine + 1 });
                    event.preventDefault();
                }
            }, true);

            this.editor.addEventListener('keydown', (event) => {
                if (event.key !== 'Backspace' && event.key !== 'Delete') return;
                const selectionStart = this.getVisibleSelectionStart();
                const selectionEnd = this.getVisibleSelectionEnd();
                let from = selectionStart;
                let to = selectionEnd;
                if (from === to) {
                    if (event.key === 'Backspace') from = Math.max(0, from - 1);
                    if (event.key === 'Delete') to = Math.min(this.projection.displayText.length, to + 1);
                }
                const blocked = sfRangeTouchesSynthetic(this.projection, from, to);
                if (!blocked) return;
                const section = this.findSectionByMarker(blocked.marker);
                if (section) this.setExpanded(section.marker, true, { focus: true, rawLineNumber: section.startLine + 1 });
                event.preventDefault();
            }, true);

            this.editor.addEventListener('input', () => {
                const visibleText = this.nativeValue.get.call(this.editor);
                const visibleStart = this.nativeSelectionStart.get.call(this.editor);
                const visibleEnd = this.nativeSelectionEnd.get.call(this.editor);
                if (visibleText === this.projection.displayText) return;

                const applied = sfApplyVisibleEdit(this.projection, visibleText, {
                    selectionStart: visibleStart,
                    selectionEnd: visibleEnd,
                });
                if (applied.blocked) {
                    const section = this.findSectionByMarker(applied.blocked.marker);
                    if (section) this.setExpanded(section.marker, true, { focus: true, rawLineNumber: section.startLine + 1 });
                    this.refreshProjection();
                    return;
                }

                const rawSelectionStart = sfTranslateEditedVisibleOffset(this.projection, applied.diff, visibleStart);
                const rawSelectionEnd = sfTranslateEditedVisibleOffset(this.projection, applied.diff, visibleEnd);
                this.setRawText(applied.rawText, { rawSelectionStart: rawSelectionStart, rawSelectionEnd: rawSelectionEnd });
            }, true);
        }

        syncProjectState() {
            const projectId = this.getProjectId() || 'default';
            if (projectId === this.projectId) return;
            this.projectId = projectId;
            let saved = null;
            try {
                saved = sfParseStoredState(global.localStorage ? global.localStorage.getItem(sfStorageKey(projectId, this.storageNamespace)) : null);
            } catch (error) {
                saved = sfParseStoredState(null);
            }
            this.state = saved;
        }

        saveState() {
            try {
                if (global.localStorage) {
                    global.localStorage.setItem(sfStorageKey(this.getProjectId() || 'default', this.storageNamespace), JSON.stringify(this.state));
                }
            } catch (error) {
                // Ignore unavailable/full storage — the editor still works.
            }
        }

        getRawText() {
            return this.projection ? this.projection.rawText : '';
        }

        getDisplayText() {
            return this.projection ? this.projection.displayText : '';
        }

        getProjection() {
            return this.projection;
        }

        getVisibleSelectionStart() {
            return this.nativeSelectionStart.get.call(this.editor);
        }

        getVisibleSelectionEnd() {
            return this.nativeSelectionEnd.get.call(this.editor);
        }

        getRawSelectionStart() {
            return sfRawOffsetFromVisibleOffset(this.projection, this.getVisibleSelectionStart(), 'start');
        }

        getRawSelectionEnd() {
            return sfRawOffsetFromVisibleOffset(this.projection, this.getVisibleSelectionEnd(), 'end');
        }

        setRawSelectionRange(start, end, direction) {
            const visibleStart = sfVisibleOffsetFromRawOffset(this.projection, start, 'start');
            const visibleEnd = sfVisibleOffsetFromRawOffset(this.projection, end, 'end');
            this.nativeSetSelectionRange.call(this.editor, visibleStart, visibleEnd, direction);
        }

        setRawText(nextText, options) {
            this.syncProjectState();
            const rawText = typeof nextText === 'string' ? nextText : '';
            const opts = options || {};
            let rawSelectionStart = typeof opts.rawSelectionStart === 'number' ? opts.rawSelectionStart : this.getRawSelectionStart();
            let rawSelectionEnd = typeof opts.rawSelectionEnd === 'number' ? opts.rawSelectionEnd : this.getRawSelectionEnd();
            this.projection = sfBuildProjection(rawText, this.descriptors, this.state, {
                hideLeadingFrontMatter: this.hideLeadingFrontMatter,
                disableSectionFolding: this.disableSectionFolding,
            });
            this.nativeValue.set.call(this.editor, this.projection.displayText);
            const visibleStart = sfVisibleOffsetFromRawOffset(this.projection, rawSelectionStart, 'start');
            const visibleEnd = sfVisibleOffsetFromRawOffset(this.projection, rawSelectionEnd, 'end');
            this.nativeSetSelectionRange.call(this.editor, visibleStart, visibleEnd, opts.direction);
            if (typeof this.editor._updateLineNumbers === 'function') {
                this.editor._updateLineNumbers();
            } else {
                this.renderOverlay();
                this.updateToolbar();
            }
        }

        refreshProjection() {
            this.setRawText(this.getRawText(), {
                rawSelectionStart: this.getRawSelectionStart(),
                rawSelectionEnd: this.getRawSelectionEnd(),
            });
        }

        setFrontMatterPresentation(mode) {
            const hideLeading = mode === 'structured';
            const disableFolding = mode === 'raw';
            if (hideLeading === this.hideLeadingFrontMatter && disableFolding === this.disableSectionFolding) return;
            this.hideLeadingFrontMatter = hideLeading;
            this.disableSectionFolding = disableFolding;
            this.refreshProjection();
        }

        updateToolbar() {
            if (!this.toolbar) return;
            const toggle = this.toolbar.querySelector('[data-action="default-expanded"]');
            if (toggle) toggle.checked = !!this.state.defaultExpanded;
            this.toolbar.style.display = this.projection.sections.length ? '' : 'none';
        }

        renderOverlay() {
            if (!this.overlay) return;
            this.overlay.innerHTML = '';
            if (!this.projection.sections.length) {
                this.overlay.style.display = 'none';
                return;
            }
            this.overlay.style.display = '';
            const style = global.getComputedStyle ? global.getComputedStyle(this.editor) : null;
            const lineHeight = style ? (parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.5) || 21) : 21;
            const paddingTop = style ? (parseFloat(style.paddingTop) || 0) : 0;
            const paddingLeft = style ? (parseFloat(style.paddingLeft) || 0) : 0;
            const paddingRight = style ? (parseFloat(style.paddingRight) || 0) : 0;

            this.projection.displayLines.forEach((line, index) => {
                if (line.kind !== 'header') return;
                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'section-fold-header-row' + (line.expanded ? ' is-expanded' : '');
                header.setAttribute('aria-expanded', line.expanded ? 'true' : 'false');
                header.setAttribute('title', (line.expanded ? 'Collapse ' : 'Expand ') + line.section.label);
                header.style.top = (paddingTop + (index * lineHeight)) + 'px';
                header.style.left = paddingLeft + 'px';
                header.style.right = paddingRight + 'px';
                header.style.height = lineHeight + 'px';

                header.addEventListener('click', (event) => {
                    event.preventDefault();
                    this.toggleSection(line.marker, { focus: true, rawLineNumber: line.rawLineNumber });
                });
                const chevron = document.createElement('span');
                chevron.className = 'section-fold-chevron';
                chevron.setAttribute('aria-hidden', 'true');
                chevron.innerHTML = line.expanded ? '&#9662;' : '&#9656;';
                const summary = document.createElement('span');
                summary.className = 'section-fold-summary';
                summary.textContent = line.summary;
                header.appendChild(chevron);
                header.appendChild(summary);
                this.overlay.appendChild(header);
            });
        }

        findSectionByMarker(marker) {
            const normalised = sfNormaliseMarker(marker);
            return this.projection.sections.find((section) => section.normalisedMarker === normalised) || null;
        }

        toggleSection(marker, options) {
            this.setExpanded(marker, !sfIsExpanded(this.state, marker), options);
        }

        setExpanded(marker, expanded, options) {
            this.state = sfSetExpanded(this.state, marker, !!expanded);
            this.saveState();
            this.setRawText(this.getRawText(), {
                rawSelectionStart: options && typeof options.rawSelectionStart === 'number' ? options.rawSelectionStart : this.getRawSelectionStart(),
                rawSelectionEnd: options && typeof options.rawSelectionEnd === 'number' ? options.rawSelectionEnd : this.getRawSelectionEnd(),
            });
            // revealRawLine deliberately expands a collapsed section. Calling
            // it after a collapse therefore undid the click immediately and
            // made the header appear unresponsive. Only move the caret into
            // section content when the action was an expansion.
            if (expanded && options && options.focus) {
                this.revealRawLine(options.rawLineNumber || sfFindSectionStartLine(this.getRawText(), marker, this.descriptors));
            }
        }

        setDefaultExpanded(expanded) {
            const keepStates = {};
            this.projection.sections.forEach((section) => {
                keepStates[section.normalisedMarker] = sfIsExpanded(this.state, section.marker);
            });
            this.state = { defaultExpanded: !!expanded, overrides: {} };
            Object.keys(keepStates).forEach((normalisedMarker) => {
                const section = this.projection.sections.find((item) => item.normalisedMarker === normalisedMarker);
                if (section) {
                    this.state = sfSetExpanded(this.state, section.marker, keepStates[normalisedMarker]);
                }
            });
            this.saveState();
            this.refreshProjection();
        }

        collapseAll() {
            let next = { defaultExpanded: this.state.defaultExpanded, overrides: Object.assign({}, this.state.overrides) };
            this.projection.sections.forEach((section) => {
                next = sfSetExpanded(next, section.marker, false);
            });
            this.state = next;
            this.saveState();
            this.refreshProjection();
        }

        expandAll() {
            let next = { defaultExpanded: this.state.defaultExpanded, overrides: Object.assign({}, this.state.overrides) };
            this.projection.sections.forEach((section) => {
                next = sfSetExpanded(next, section.marker, true);
            });
            this.state = next;
            this.saveState();
            this.refreshProjection();
        }

        revealRawLine(rawLineNumber) {
            const line = Math.max(1, rawLineNumber | 0);
            const collapsedSection = sfFindCollapsedSectionForRawLine(this.projection, line);
            if (collapsedSection) {
                this.state = sfSetExpanded(this.state, collapsedSection.marker, true);
                this.saveState();
                this.setRawText(this.getRawText());
            }
            const visibleLine = sfVisibleLineFromRawLine(this.projection, line);
            let position = 0;
            for (let i = 0; i < visibleLine - 1 && i < this.projection.displayLines.length; i++) {
                position += this.projection.displayLines[i].text.length + 1;
            }
            this.editor.focus();
            this.nativeSetSelectionRange.call(this.editor, position, position);
            const style = global.getComputedStyle ? global.getComputedStyle(this.editor) : null;
            const lineHeight = style ? (parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.5) || 21) : 21;
            this.editor.scrollTop = Math.max(0, ((visibleLine - 3) * lineHeight));
            this.editor.dispatchEvent(new Event('scroll'));
        }
    }

    function sfAttach(options) {
        if (!options || !options.editor) return null;
        if (sfControllers.has(options.editor)) return sfControllers.get(options.editor);
        const controller = new SectionFoldingController(options);
        sfControllers.set(options.editor, controller);
        return controller;
    }

    function sfControllerFor(editor) {
        return editor ? (sfControllers.get(editor) || null) : null;
    }

    function sfJumpToBackMatterSection(marker, rowId, outputViewName) {
        if (typeof NavigationController !== 'undefined' && NavigationController && typeof NavigationController.navigateTo === 'function') {
            NavigationController.navigateTo(outputViewName || 'tasks');
        } else if (typeof activateTabContent === 'function') {
            activateTabContent('editor');
        }
        const editor = document.getElementById('planEditor');
        if (!editor) return false;
        const controller = sfControllerFor(editor);
        const rawText = editor.value;
        const lineNumber = rowId == null
            ? sfFindSectionStartLine(rawText, marker, controller ? controller.descriptors : [])
            : sfFindTableRowLine(rawText, marker, rowId, controller ? controller.descriptors : []);
        if (controller) {
            const section = controller.findSectionByMarker(marker);
            if (section && !sfIsExpanded(controller.state, marker)) {
                controller.state = sfSetExpanded(controller.state, marker, true);
                controller.saveState();
                controller.setRawText(rawText);
            }
            if (lineNumber > 0) controller.revealRawLine(lineNumber);
        } else if (typeof goToEditorLine === 'function' && lineNumber > 0) {
            goToEditorLine(lineNumber);
        }
        return lineNumber > 0;
    }

    global.SectionFolding = {
        attach: sfAttach,
        controllerFor: sfControllerFor,
        getDisplayText(editor) {
            const controller = sfControllerFor(editor);
            return controller ? controller.getDisplayText() : (editor ? editor.value : '');
        },
        getProjection(editor) {
            const controller = sfControllerFor(editor);
            return controller ? controller.getProjection() : null;
        },
        getVisibleSelectionStart(editor) {
            const controller = sfControllerFor(editor);
            return controller ? controller.getVisibleSelectionStart() : (editor ? editor.selectionStart : 0);
        },
        getVisibleSelectionEnd(editor) {
            const controller = sfControllerFor(editor);
            return controller ? controller.getVisibleSelectionEnd() : (editor ? editor.selectionEnd : 0);
        },
        visibleLineFromVisibleOffset: sfVisibleLineFromVisibleOffset,
        jumpToBackMatterSection: sfJumpToBackMatterSection,
        findSectionStartLine: sfFindSectionStartLine,
        findTableRowLine: sfFindTableRowLine,
        storageKey: sfStorageKey,
        parseStoredState: sfParseStoredState,
        isExpanded: sfIsExpanded,
        setExpanded: sfSetExpanded,
        countMarkdownTableRows: sfCountMarkdownTableRows,
        countNonEmptyLines: sfCountNonEmptyLines,
        countHighlightEntries: sfCountHighlightEntries,
        collectSectionInstances: sfCollectSectionInstances,
        buildProjection: sfBuildProjection,
        applyVisibleEdit: sfApplyVisibleEdit,
        visibleOffsetFromRawOffset: sfVisibleOffsetFromRawOffset,
        rawOffsetFromVisibleOffset: sfRawOffsetFromVisibleOffset,
        visibleLineFromRawLine: sfVisibleLineFromRawLine,
        formatCount: sfFormatCount,
        escapeHtml: sfEscapeHtml,
        translateEditedVisibleOffset: sfTranslateEditedVisibleOffset,
    };
}(window));
