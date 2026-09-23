/**
 * gantt-scale.js -- the Gantt chart's coordinate model (#787).
 *
 * Everything here is pure: no DOM, no globals, so it is unit-tested directly
 * (tests/test_gantt_scale.mjs) and views-gantt.js only has to turn its
 * answers into elements.
 *
 * One number drives the chart: `pixelsPerDay`. The five named scales (days,
 * weeks, months, quarters, years) are detents on a continuous zoom, not the
 * only values it can take. The header bands, the drag snap unit, and every
 * bar's geometry are derived from that one number, so there is a single
 * rendering rule instead of one code path per scale.
 *
 * Dates are integer day numbers (days since 1970-01-01, UTC) throughout, the
 * same representation as engine/date-math.js, so a DST change can never make
 * a day 23 or 25 hours long and shift a bar by a pixel.
 *
 * The second half of the file edits a single task line: the Gantt's drag
 * writes a new duration or start date back into the markdown. It locates the
 * token the scheduler actually reads (engine/tokeniser.js's DURATION and DATE
 * rules) rather than guessing by position, so a task named "Print 3d model"
 * or a line carrying `$product`, `!priority`, `{bucket}` or a `* +2d` lag is
 * rewritten in the right place.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.GanttScale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DAY_MS = 86400000;

    // ----- Zoom -----------------------------------------------------------

    /** The labelled detents on the zoom slider, finest first. The pixel
     *  densities are the ones the old five-way <select> used, so a plan
     *  looks the same at "Days" as it always did. */
    const DETENTS = [
        { name: 'days', label: 'Days', pixelsPerDay: 28 },
        { name: 'weeks', label: 'Weeks', pixelsPerDay: 12 },
        { name: 'months', label: 'Months', pixelsPerDay: 5 },
        { name: 'quarters', label: 'Quarters', pixelsPerDay: 3 },
        { name: 'years', label: 'Years', pixelsPerDay: 1 },
    ];
    const DEFAULT_PIXELS_PER_DAY = 28;
    const MIN_PIXELS_PER_DAY = 0.5;
    const MAX_PIXELS_PER_DAY = 48;
    /** The slider's integer range. Its position is logarithmic in
     *  pixelsPerDay, so each step is the same *proportional* zoom whether the
     *  chart shows days or years. */
    const SLIDER_MAX = 1000;
    /** How close (in slider steps) a drag must come to a detent to land on it. */
    const DETENT_CAPTURE = 18;

    const LOG_MIN = Math.log(MIN_PIXELS_PER_DAY);
    const LOG_SPAN = Math.log(MAX_PIXELS_PER_DAY) - LOG_MIN;

    function clampPixelsPerDay(ppd) {
        const value = Number(ppd);
        if (!Number.isFinite(value) || value <= 0) return DEFAULT_PIXELS_PER_DAY;
        return Math.min(MAX_PIXELS_PER_DAY, Math.max(MIN_PIXELS_PER_DAY, value));
    }

    function pixelsPerDayToSlider(ppd) {
        return Math.round(SLIDER_MAX * (Math.log(clampPixelsPerDay(ppd)) - LOG_MIN) / LOG_SPAN);
    }

    /** Slider position -> pixelsPerDay, captured by a detent when close to one. */
    function sliderToPixelsPerDay(position, options = {}) {
        const pos = Math.min(SLIDER_MAX, Math.max(0, Number(position) || 0));
        if (pos === 0) return MIN_PIXELS_PER_DAY;
        if (pos === SLIDER_MAX) return MAX_PIXELS_PER_DAY;
        if (options.snap !== false) {
            for (const detent of DETENTS) {
                if (Math.abs(pixelsPerDayToSlider(detent.pixelsPerDay) - pos) <= DETENT_CAPTURE) {
                    return detent.pixelsPerDay;
                }
            }
        }
        return clampPixelsPerDay(Math.exp(LOG_MIN + LOG_SPAN * pos / SLIDER_MAX));
    }

    function detentByName(name) {
        return DETENTS.find(d => d.name === name) || null;
    }

    /** The named scale nearest a pixel density (by ratio, not difference). */
    function nearestDetent(ppd) {
        const value = clampPixelsPerDay(ppd);
        let best = DETENTS[0];
        for (const detent of DETENTS) {
            if (Math.abs(Math.log(value / detent.pixelsPerDay)) <
                Math.abs(Math.log(value / best.pixelsPerDay))) best = detent;
        }
        return best.name;
    }

    /** The detent `ppd` sits exactly on, or null between detents. */
    function exactDetent(ppd) {
        const found = DETENTS.find(d => Math.abs(d.pixelsPerDay - ppd) < 1e-9);
        return found ? found.name : null;
    }

    /** The one step coarser or finer than `ppd` -- what the ribbon's zoom
     *  in/out and Ctrl+wheel step through. */
    function stepZoom(ppd, direction) {
        const value = clampPixelsPerDay(ppd);
        const factor = direction > 0 ? 1.25 : 0.8;
        return clampPixelsPerDay(value * factor);
    }

    /**
     * The scroll offset that keeps the date under `anchorPx` (measured from
     * the scroll container's left edge) in place when the pixel density
     * changes from `oldPpd` to `newPpd`.
     */
    function anchoredScrollLeft(scrollLeft, anchorPx, oldPpd, newPpd) {
        const dayAtAnchor = (scrollLeft + anchorPx) / oldPpd;
        return Math.max(0, dayAtAnchor * newPpd - anchorPx);
    }

    // ----- Day numbers ----------------------------------------------------

    function dayOf(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return value;
        if (value instanceof Date) {
            return Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS);
        }
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        if (!match) return null;
        return Math.round(Date.UTC(+match[1], +match[2] - 1, +match[3]) / DAY_MS);
    }

    function isoOf(day) {
        const date = new Date(day * DAY_MS);
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function partsOf(day) {
        const date = new Date(day * DAY_MS);
        return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate(), weekday: (date.getUTCDay() + 6) % 7 };
    }

    function dayFromParts(year, month, date) {
        return Math.round(Date.UTC(year, month, date) / DAY_MS);
    }

    /** `day` shifted by `n` whole months, clamped to the target month's length
     *  (31 Jan + 1 month = 28/29 Feb, not 3 Mar). */
    function addMonths(day, n) {
        const p = partsOf(day);
        const target = new Date(Date.UTC(p.year, p.month + n, 1));
        const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        return dayFromParts(target.getUTCFullYear(), target.getUTCMonth(), Math.min(p.date, lastDay));
    }

    // ----- Header bands ---------------------------------------------------

    const UNITS = ['day', 'week', 'month', 'quarter', 'year'];
    /** Roughly how many days one cell of each unit spans. */
    const TYPICAL_DAYS = { day: 1, week: 7, month: 30.44, quarter: 91.3, year: 365.25 };
    /** The narrowest a cell of each unit may be and still carry a label worth
     *  reading. The finest unit that clears its minimum is the lower band. */
    const MIN_CELL_PX = { day: 14, week: 40, month: 36, quarter: 32, year: 30 };
    const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    /** Estimated rendered width of a header label. Deliberately generous (the
     *  header font is ~12px, ~6.5px per character on average) so a label that
     *  "fits" by this estimate is never clipped in practice. */
    function labelWidth(text) {
        return String(text).length * 7 + 8;
    }

    /** The first day of the `unit` cell containing `day`. */
    function unitStart(unit, day) {
        const p = partsOf(day);
        switch (unit) {
            case 'day': return day;
            case 'week': return day - p.weekday;                       // Monday
            case 'month': return dayFromParts(p.year, p.month, 1);
            case 'quarter': return dayFromParts(p.year, Math.floor(p.month / 3) * 3, 1);
            case 'year': return dayFromParts(p.year, 0, 1);
            default: throw new Error(`unknown unit ${unit}`);
        }
    }

    function nextUnitStart(unit, start) {
        switch (unit) {
            case 'day': return start + 1;
            case 'week': return start + 7;
            case 'month': return addMonths(start, 1);
            case 'quarter': return addMonths(start, 3);
            case 'year': return addMonths(start, 12);
            default: throw new Error(`unknown unit ${unit}`);
        }
    }

    /** Candidate labels for a cell, longest first. */
    function labelCandidates(unit, start) {
        const p = partsOf(start);
        const yy = String(p.year).slice(-2);
        switch (unit) {
            case 'day': return [`${WEEKDAYS_SHORT[p.weekday]} ${p.date}`, WEEKDAY_INITIALS[p.weekday]];
            case 'week': return [`${p.date} ${MONTHS_SHORT[p.month]} '${yy}`, `${p.date} ${MONTHS_SHORT[p.month]}`, String(p.date)];
            case 'month': return [`${MONTHS_LONG[p.month]} ${p.year}`, `${MONTHS_SHORT[p.month]} ${p.year}`,
                `${MONTHS_SHORT[p.month]} '${yy}`, MONTHS_SHORT[p.month], MONTHS_SHORT[p.month][0]];
            case 'quarter': return [`Q${Math.floor(p.month / 3) + 1} ${p.year}`, `Q${Math.floor(p.month / 3) + 1}`];
            case 'year': return [String(p.year), `'${yy}`];
            default: return [''];
        }
    }

    function titleFor(unit, start) {
        const p = partsOf(start);
        switch (unit) {
            case 'day': return `${WEEKDAYS_SHORT[p.weekday]} ${p.date} ${MONTHS_SHORT[p.month]} ${p.year}`;
            case 'week': return `Week commencing ${p.date} ${MONTHS_SHORT[p.month]} ${p.year}`;
            case 'month': return `${MONTHS_LONG[p.month]} ${p.year}`;
            case 'quarter': return `Q${Math.floor(p.month / 3) + 1} ${p.year}`;
            default: return String(p.year);
        }
    }

    /** The longest candidate label that fits `widthPx`, or '' if none does. */
    function fitLabel(candidates, widthPx) {
        for (const text of candidates) {
            if (labelWidth(text) <= widthPx) return text;
        }
        return '';
    }

    /** The finest unit whose typical cell is wide enough to label. */
    function finestUnit(ppd) {
        for (const unit of UNITS) {
            if (TYPICAL_DAYS[unit] * ppd >= MIN_CELL_PX[unit]) return unit;
        }
        return 'year';
    }

    /**
     * Header bands for the chart range [fromDay, toDay] (both inclusive) at
     * `ppd`. Always two rows -- a coarse band above a fine one -- so the header
     * is the same height at every zoom and the task table stays aligned.
     *
     * Each cell is { start, days, left, width, label, title }. Cells are
     * clipped to the range; a clipped edge cell gets a shorter label, or none,
     * rather than one that overflows.
     */
    function headerBands(fromDay, toDay, ppd) {
        const fine = finestUnit(ppd);
        const coarse = UNITS[Math.min(UNITS.length - 1, UNITS.indexOf(fine) + 1)];
        const units = fine === coarse ? ['year', 'year'] : [coarse, fine];
        return units.map((unit, index) => ({
            unit,
            role: index === 0 ? 'coarse' : 'fine',
            cells: bandCells(unit, fromDay, toDay, ppd),
        }));
    }

    function bandCells(unit, fromDay, toDay, ppd) {
        const cells = [];
        const end = toDay + 1;                        // exclusive
        let start = unitStart(unit, fromDay);
        while (start < end) {
            const next = nextUnitStart(unit, start);
            const clippedStart = Math.max(start, fromDay);
            const clippedEnd = Math.min(next, end);
            const days = clippedEnd - clippedStart;
            const width = days * ppd;
            cells.push({
                unit,
                start: clippedStart,
                days,
                left: (clippedStart - fromDay) * ppd,
                width,
                label: fitLabel(labelCandidates(unit, start), width),
                title: titleFor(unit, start),
            });
            start = next;
        }
        return cells;
    }

    // ----- Geometry -------------------------------------------------------

    /**
     * A bar's horizontal position. Finish is exclusive, as the scheduler
     * reports it; a zero-length span still gets one day so it stays visible.
     */
    function barGeometry(startDay, finishDay, fromDay, ppd) {
        const left = (startDay - fromDay) * ppd;
        const days = Math.max(1, finishDay - startDay);
        return { left, width: days * ppd };
    }

    // ----- Drag snapping --------------------------------------------------

    /** Minimum on-screen width of one snap step, in pixels. Below this a
     *  pixel of pointer jitter would move the task a whole step. */
    const MIN_SNAP_PX = 10;

    /**
     * The unit a drag moves in at `ppd`: days when zoomed in, weeks or months
     * when zoomed out, whichever is the finest that is still at least
     * MIN_SNAP_PX wide on screen.
     */
    function snapUnit(ppd) {
        const value = clampPixelsPerDay(ppd);
        if (value >= MIN_SNAP_PX) return { unit: 'day', days: 1 };
        if (value * 7 >= MIN_SNAP_PX) return { unit: 'week', days: 7 };
        return { unit: 'month', days: 30.44 };
    }

    /** Whole snap steps covered by a pointer movement of `deltaPx`. Rounded,
     *  so the first step needs half a unit of movement -- a built-in dead zone. */
    function snapSteps(deltaPx, ppd) {
        const unit = snapUnit(ppd);
        const steps = deltaPx / (unit.days * clampPixelsPerDay(ppd));
        return (steps < 0 ? -Math.round(-steps) : Math.round(steps)) || 0;
    }

    /** `day` moved by `steps` of the snap unit at `ppd`. */
    function shiftBySteps(day, steps, ppd) {
        if (!steps) return day;
        const unit = snapUnit(ppd);
        if (unit.unit === 'month') return addMonths(day, steps);
        return day + steps * unit.days;
    }

    // ----- Task-line editing ---------------------------------------------

    // The scheduler's own token rules (engine/tokeniser.js).
    const DURATION = /(?<!~)(?<![~/])\b(\d+)([dwmy])\b/;
    const STAR_LAG = /^\*\s*[+-]\d+[dwmy]\b/;
    const DATE = /(\d{4}-\d{2}-\d{2})/;
    const DEADLINE = /\bD(\d{4}-\d{2}-\d{2})\b/;
    const LEVELLED = /\[levelled\s+@?(\S+)\s+(\d{4}-\d{2}-\d{2})\s*\]/i;
    const DURATION_MULTIPLIERS = { d: 1, w: 7, m: 30, y: 365 };

    function blank(text, start, length) {
        return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
    }

    function splitIndent(line) {
        const indent = (line.match(/^\s*/) || [''])[0];
        return { indent, content: line.slice(indent.length) };
    }

    /** Where the scheduler reads this line's duration from, or null. */
    function findDuration(content) {
        const masked = content.replace(STAR_LAG, m => ' '.repeat(m.length));
        const match = DURATION.exec(masked);
        if (!match) return null;
        return { index: match.index, length: match[0].length, value: +match[1], unit: match[2] };
    }

    /**
     * Where the scheduler reads this line's start date from, or null: a
     * `[levelled @r date]` tag's date if present, else the first date that is
     * not part of a `D` deadline marker.
     */
    function findStartDate(content) {
        let masked = content;
        const deadline = DEADLINE.exec(masked);
        if (deadline) masked = blank(masked, deadline.index, deadline[0].length);
        const levelled = LEVELLED.exec(masked);
        if (levelled) {
            const offset = levelled[0].lastIndexOf(levelled[2]);
            return { index: levelled.index + offset, length: 10 };
        }
        const date = DATE.exec(masked);
        return date ? { index: date.index, length: 10 } : null;
    }

    /** Working days as a duration token, keeping the line's unit when the
     *  new value is a whole number of it (3w stays in weeks if it can). */
    function formatDuration(days, preferredUnit) {
        const unit = preferredUnit && DURATION_MULTIPLIERS[preferredUnit] ? preferredUnit : 'd';
        const mult = DURATION_MULTIPLIERS[unit];
        if (unit !== 'd' && days > 0 && days % mult === 0) return `${days / mult}${unit}`;
        return `${days}d`;
    }

    function appendToken(content, token) {
        const trimmed = content.replace(/\s+$/, '');
        const trailing = content.slice(trimmed.length);
        return `${trimmed} ${token}${trailing}`;
    }

    /** `line` with its duration set to `days` working days. */
    function setLineDuration(line, days) {
        const { indent, content } = splitIndent(line);
        const found = findDuration(content);
        if (found) {
            const token = formatDuration(days, found.unit);
            return indent + content.slice(0, found.index) + token + content.slice(found.index + found.length);
        }
        return indent + appendToken(content, formatDuration(days, 'd'));
    }

    /** `line` with its start date set to `iso` (YYYY-MM-DD). */
    function setLineStart(line, iso) {
        const { indent, content } = splitIndent(line);
        const found = findStartDate(content);
        if (found) {
            return indent + content.slice(0, found.index) + iso + content.slice(found.index + found.length);
        }
        return indent + appendToken(content, iso);
    }

    /** The duration the scheduler reads from `line`, in its written unit. */
    function lineDuration(line) {
        const found = findDuration(splitIndent(line).content);
        return found ? { value: found.value, unit: found.unit } : null;
    }

    return {
        DETENTS, DEFAULT_PIXELS_PER_DAY, MIN_PIXELS_PER_DAY, MAX_PIXELS_PER_DAY,
        SLIDER_MAX, MIN_SNAP_PX,
        clampPixelsPerDay, pixelsPerDayToSlider, sliderToPixelsPerDay,
        detentByName, nearestDetent, exactDetent, stepZoom, anchoredScrollLeft,
        dayOf, isoOf, addMonths,
        headerBands, finestUnit, labelWidth,
        barGeometry,
        snapUnit, snapSteps, shiftBySteps,
        setLineDuration, setLineStart, lineDuration, formatDuration,
    };
});
