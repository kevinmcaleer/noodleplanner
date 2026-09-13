/**
 * Natural-language date detection in free-form text (issue #1160, part of
 * epic #878's "Natural-language date capture").
 *
 * Pure, DOM-free: given a string, finds every date-like phrase in it and
 * resolves each straight to an ISO `YYYY-MM-DD` string, so a caller (see
 * smart-date-tags.js) never has to parse "15th March" itself. This file
 * only *finds* candidates -- it never writes anything back to a task, and
 * a candidate existing here has no effect on anything by itself. That
 * matches #878's own design decision, "suggestion layer, never silent
 * assumption": detection and application are deliberately two separate
 * files so a detector change can never accidentally start auto-applying
 * dates.
 *
 * Supported phrasing (deliberately a fixed, modest set rather than a full
 * NL date grammar -- good enough for how people actually write dates into
 * a post-it, per the epic's own example, "go live 15th March"):
 *   - ISO: 2026-03-15
 *   - "15th March", "15 March 2027", "1 Jan"
 *   - "March 15th", "March 15, 2027", "Jan 1"
 *   - today, tomorrow
 *   - next Friday (any weekday name)
 *   - in 2 weeks / in 3 days / in 1 month
 *
 * A day/month phrase with no year picks the nearest occurrence on or after
 * `referenceDate` (this year, or next year if that date has already
 * passed) -- "go live 15th March" written in September means next March,
 * not the one five months ago.
 */
const DateDetect = (() => {
    const MONTHS = [
        ['january', 0], ['jan', 0],
        ['february', 1], ['feb', 1],
        ['march', 2], ['mar', 2],
        ['april', 3], ['apr', 3],
        ['may', 4],
        ['june', 5], ['jun', 5],
        ['july', 6], ['jul', 6],
        ['august', 7], ['aug', 7],
        ['september', 8], ['sept', 8], ['sep', 8],
        ['october', 9], ['oct', 9],
        ['november', 10], ['nov', 10],
        ['december', 11], ['dec', 11],
    ];
    const MONTH_LOOKUP = new Map(MONTHS);
    // Longest names first so e.g. "sept" isn't cut short by "sep" matching
    // first inside the same alternation.
    const MONTH_NAME_PATTERN = MONTHS.map(([name]) => name)
        .sort((a, b) => b.length - a.length)
        .join('|');

    const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    /** `YYYY-MM-DD` from a Date's own local components -- never a UTC
     * conversion, so this can't slip a day at timezone boundaries the way
     * `date.toISOString()` can. */
    function isoOf(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function addDays(date, n) {
        const result = startOfDay(date);
        result.setDate(result.getDate() + n);
        return result;
    }

    function addMonths(date, n) {
        const result = startOfDay(date);
        result.setMonth(result.getMonth() + n);
        return result;
    }

    /** The nearest `month`/`day` on or after `reference`: this year, unless
     * that date has already passed, in which case next year. An explicit
     * `year` always wins outright. */
    function nearestFutureDate(reference, month, day, explicitYear) {
        if (explicitYear) return new Date(explicitYear, month, day);
        const ref = startOfDay(reference);
        let candidate = new Date(ref.getFullYear(), month, day);
        if (candidate < ref) candidate = new Date(ref.getFullYear() + 1, month, day);
        return candidate;
    }

    /** The next occurrence of `weekdayIndex` (0 = Sunday) strictly after
     * `reference` -- "next Friday" said on a Friday means the following
     * Friday, not today. */
    function nextWeekday(reference, weekdayIndex) {
        const ref = startOfDay(reference);
        const diff = (weekdayIndex - ref.getDay() + 7) % 7;
        const offset = diff === 0 ? 7 : diff;
        return addDays(ref, offset);
    }

    /** Drop any candidate whose span overlaps an earlier (by start index,
     * then by longer match) one already kept -- so e.g. "March" isn't
     * separately reported inside an already-matched "15th March 2027". */
    function dedupeOverlapping(candidates) {
        const sorted = candidates.slice().sort((a, b) => a.index - b.index || b.length - a.length);
        const result = [];
        let lastEnd = -1;
        sorted.forEach(candidate => {
            if (candidate.index >= lastEnd) {
                result.push(candidate);
                lastEnd = candidate.index + candidate.length;
            }
        });
        return result;
    }

    /**
     * Find every date-like phrase in `text`. Returns an array of
     * `{ text, index, length, isoDate }`, sorted left to right, with
     * overlapping matches already resolved (see dedupeOverlapping()).
     * `referenceDate` defaults to now; pass a fixed Date in tests so
     * relative phrases ("tomorrow", "in 2 weeks") are deterministic.
     */
    function detectDatesInText(text, referenceDate) {
        const source = String(text || '');
        if (!source.trim()) return [];
        // Duck-typed rather than `referenceDate instanceof Date`: a Date
        // constructed in a different realm than this function runs in
        // (e.g. a vm-sandboxed unit test's Date vs. this file's own, or a
        // future iframe/worker boundary) is a perfectly good Date but
        // fails `instanceof` across that realm boundary.
        const reference = (referenceDate && typeof referenceDate.getTime === 'function' && !isNaN(referenceDate.getTime()))
            ? referenceDate
            : new Date();
        const candidates = [];
        let m;

        // ISO: 2026-03-15
        const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
        while ((m = isoRe.exec(source))) {
            const year = Number(m[1]);
            const month = Number(m[2]) - 1;
            const day = Number(m[3]);
            const date = new Date(year, month, day);
            if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
                candidates.push({ text: m[0], index: m.index, length: m[0].length, isoDate: isoOf(date) });
            }
        }

        // "15th March[, 2027]" / "1 Jan"
        const dayMonthRe = new RegExp(
            `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME_PATTERN})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi'
        );
        while ((m = dayMonthRe.exec(source))) {
            const day = Number(m[1]);
            const month = MONTH_LOOKUP.get(m[2].toLowerCase());
            if (month === undefined || day < 1 || day > 31) continue;
            const year = m[3] ? Number(m[3]) : undefined;
            const date = nearestFutureDate(reference, month, day, year);
            if (date.getMonth() !== month || date.getDate() !== day) continue; // e.g. "31 February"
            candidates.push({ text: m[0], index: m.index, length: m[0].length, isoDate: isoOf(date) });
        }

        // "March 15[th][, 2027]" / "Jan 1"
        const monthDayRe = new RegExp(
            `\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'
        );
        while ((m = monthDayRe.exec(source))) {
            const month = MONTH_LOOKUP.get(m[1].toLowerCase());
            const day = Number(m[2]);
            if (month === undefined || day < 1 || day > 31) continue;
            const year = m[3] ? Number(m[3]) : undefined;
            const date = nearestFutureDate(reference, month, day, year);
            if (date.getMonth() !== month || date.getDate() !== day) continue;
            candidates.push({ text: m[0], index: m.index, length: m[0].length, isoDate: isoOf(date) });
        }

        // today / tomorrow
        const todayRe = /\b(today|tomorrow)\b/gi;
        while ((m = todayRe.exec(source))) {
            const offset = m[1].toLowerCase() === 'tomorrow' ? 1 : 0;
            const date = addDays(reference, offset);
            candidates.push({ text: m[0], index: m.index, length: m[0].length, isoDate: isoOf(date) });
        }

        // next <Weekday>
        const nextWeekdayRe = new RegExp(`\\bnext\\s+(${WEEKDAYS.join('|')})\\b`, 'gi');
        while ((m = nextWeekdayRe.exec(source))) {
            const weekdayIndex = WEEKDAYS.indexOf(m[1].toLowerCase());
            const date = nextWeekday(reference, weekdayIndex);
            candidates.push({ text: m[0], index: m.index, length: m[0].length, isoDate: isoOf(date) });
        }

        // in N day(s)/week(s)/month(s)
        const inNRe = /\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/gi;
        while ((m = inNRe.exec(source))) {
            const n = Number(m[1]);
            const unit = m[2].toLowerCase();
            const date = unit.startsWith('day') ? addDays(reference, n)
                : unit.startsWith('week') ? addDays(reference, n * 7)
                : addMonths(reference, n);
            candidates.push({ text: m[0], index: m.index, length: m[0].length, isoDate: isoOf(date) });
        }

        return dedupeOverlapping(candidates);
    }

    return { detectDatesInText, isoOf, nearestFutureDate, nextWeekday };
})();

// Plain global (this codebase has no bundler/module system -- every static
// JS file is a classic <script> tag sharing one global scope, per the
// convention every other static/*.js file already follows). `var`, not
// `const`/`let`: a top-level `const` never becomes a property of the
// global object (browser `window` or a vm sandbox's context alike), which
// is exactly what tests/test_date_detect.js loads this file to call.
var detectDatesInText = DateDetect.detectDatesInText;
