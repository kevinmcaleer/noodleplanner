// ExcelJS is vendored, not fetched from a CDN: the app is installable as a
// PWA and must export offline, its service worker only caches same-origin
// /static/, and the deployment is self-hosted behind a tunnel (issue #790).
// Refresh it with `npm run vendor:exceljs`.
export const EXCELJS_URL = '/static/vendor/exceljs/exceljs.min.js';
export const BROWSER_EXCEL_WORKER_URL = '/static/browser-excel-worker.js';
export const EXCELJS_LOAD_TIMEOUT_MS = 30000;

export const XL_TASK_HEADERS = [
    'ID', 'Task Name', 'Start', 'Finish', 'Duration (days)',
    'Resources', '% Complete', 'RAG', 'Priority', 'Bucket',
    'Dependencies', 'Comment'
];
export const XL_MILESTONE_BASE_HEADERS = ['Milestone', 'Type', 'Date'];
export const XL_MILESTONE_BASELINE_HEADERS = ['Baseline Finish', 'Variance (days)'];
export const XL_BUDGET_HEADERS = [
    'ID', 'Description', 'Estimate', 'Forecast', 'Type',
    'Invoice', 'PO', 'Supplier', 'Total', 'Ordered',
    'Received', 'Category'
];
export const XL_BUDGET_COLUMN_WIDTHS = [6, 30, 12, 12, 10, 15, 12, 20, 12, 12, 12, 18];
export const XL_RAID_HEADERS = [
    'ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner',
    'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status',
    'Priority', 'Target Date'
];
export const XL_RAID_ROUTE_HEADERS = [
    'ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner',
    'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status'
];
export const XL_RAID_COLUMN_WIDTHS = {
    'ID': 6,
    'Type': 14,
    'Title': 25,
    'Description': 35,
    'Raised By': 15,
    'Owner': 15,
    'Mitigation Actions': 35,
    'Impact': 10,
    'Likelihood': 12,
    'Score': 8,
    'Status': 14,
    'Priority': 12,
    'Target Date': 14,
};
export const XL_STAKEHOLDER_HEADERS = ['Name', 'Role', 'Interest', 'Influence'];
export const XL_STAKEHOLDER_COLUMN_WIDTHS = [25, 30, 12, 12];
export const XL_COMMS_HEADERS = ['ID', 'Activity', 'Audience', 'Content', 'Frequency', 'Channel', 'Owner', 'Status'];
export const XL_COMMS_COLUMN_WIDTHS = { A: 5, B: 25, C: 20, D: 30, E: 12, F: 12, G: 18, H: 10 };
export const XL_LESSONS_HEADERS = [
    'ID', 'Project Manager', 'Project Type', 'Technology',
    'Project Phase', 'Area', 'Impact Type', 'Observation',
    'Impact', 'Recommendations', 'Date'
];
export const XL_LESSONS_COLUMN_WIDTHS = {
    A: 5, B: 18, C: 16, D: 16, E: 14,
    F: 16, G: 16, H: 40, I: 30, J: 30, K: 12,
};
export const XL_RAG_STATUS_TO_COLOUR = {
    'not started': 'green',
    'on track': 'green',
    'ahead of schedule': 'green',
    'complete': 'blue',
    'completed': 'grey',
    'behind schedule': 'amber',
    'task overdue': 'red',
    'green': 'green',
    'amber': 'amber',
    'red': 'red',
    'blue': 'blue',
    'grey': 'grey',
    'gray': 'grey',
};
export const XL_RAG_FILLS = {
    green: '92D050',
    amber: 'FFC000',
    red: 'FF0000',
    blue: '1976D2',
    grey: '808080',
};

function hasNodeProcess() {
    return typeof process !== 'undefined' && !!(process.versions && process.versions.node);
}

let excelJsLoadPromise = null;

/**
 * The browser path is the default (issue #790); the server exporters stay
 * one flag away, the same flag the PDF and Word exports use.
 */
export function browserExcelEnabled() {
    try {
        return !(typeof localStorage !== 'undefined' && localStorage.getItem('np-server-exports') === '1');
    } catch (_error) {
        return true;
    }
}

function argb(hex) {
    const clean = String(hex || '').replace(/^#/, '').toUpperCase();
    return clean.length === 8 ? clean : `FF${clean}`;
}

function solidFill(hex) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } };
}

function fontStyle({ bold = false, color = null, size = undefined } = {}) {
    const style = {};
    if (bold) style.bold = true;
    if (color) style.color = { argb: argb(color) };
    if (size !== undefined) style.size = size;
    return style;
}

function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof globalThis.parseLocalDate === 'function') return globalThis.parseLocalDate(value);
    const parts = String(value).split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
            return new Date(year, month, day);
        }
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date) {
    if (!date) return '';
    if (typeof date === 'string') return date;
    if (typeof globalThis.formatLocalDate === 'function') return globalThis.formatLocalDate(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateTimeLocal(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function capitalize(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function splitResources(resources) {
    return String(resources || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function setHeaderStyle(
    row,
    fillHex = '366092',
    font = { bold: true, color: 'FFFFFF' },
    vertical = 'middle'
) {
    row.eachCell((cell) => {
        cell.fill = solidFill(fillHex);
        cell.font = fontStyle(font);
        cell.alignment = { horizontal: 'center' };
        if (vertical) cell.alignment.vertical = vertical;
    });
}

function fitColumnsToContent(worksheet, headerCount, cap = 50) {
    for (let idx = 1; idx <= headerCount; idx += 1) {
        let maxLength = 0;
        worksheet.getColumn(idx).eachCell({ includeEmpty: true }, (cell) => {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        worksheet.getColumn(idx).width = Math.min(maxLength + 2, cap);
    }
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
}

async function ensureExcelJsLoaded() {
    if (globalThis.ExcelJS) return globalThis.ExcelJS;
    if (hasNodeProcess()) {
        const mod = await import('exceljs');
        return mod.default || mod;
    }
    if (typeof document === 'undefined') {
        throw new Error('ExcelJS is not available');
    }

    if (!excelJsLoadPromise) {
        document.querySelectorAll(`script[src="${EXCELJS_URL}"]`).forEach((script) => script.remove());
        excelJsLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const timeout = window.setTimeout(() => {
                script.remove();
                reject(new Error('Timed out loading ExcelJS'));
            }, EXCELJS_LOAD_TIMEOUT_MS);
            const finish = (callback) => {
                window.clearTimeout(timeout);
                callback();
            };
            script.src = EXCELJS_URL;
            script.onload = () => finish(resolve);
            script.onerror = () => finish(() => {
                script.remove();
                reject(new Error('Failed to load ExcelJS'));
            });
            document.head.appendChild(script);
        });
    }

    try {
        await excelJsLoadPromise;
    } catch (error) {
        excelJsLoadPromise = null;
        throw error;
    }
    if (!globalThis.ExcelJS) {
        excelJsLoadPromise = null;
        throw new Error('ExcelJS did not initialise correctly');
    }
    return globalThis.ExcelJS;
}

function displayTaskName(task, indented = true) {
    const text = String(task.name || '').replace(/_/g, ' ');
    if (!indented) return text;
    const level = Number(task.level || 0);
    return level > 0 ? `${'  '.repeat(level)}${text}` : text;
}

export function xlRagColour(status) {
    return XL_RAG_STATUS_TO_COLOUR[String(status || '').toLowerCase()] || '';
}

function taskNameToIdMap(tasks) {
    const nameToId = new Map();
    tasks.forEach((current, index) => {
        const keys = [current.key, current.name].filter(Boolean);
        keys.forEach((key) => nameToId.set(String(key).toLowerCase(), index + 1));
    });
    return nameToId;
}

function taskDependencyString(nameToId, task) {
    const depends = Array.isArray(task.depends) ? task.depends : [];
    return depends.map((depName) => {
        const depId = nameToId.get(String(depName).toLowerCase());
        if (!depId) return null;
        const depType = (task.dependency_types && task.dependency_types[depName]) || 'FS';
        const lag = (task.lag_lead && task.lag_lead[depName]) || '';
        return `${depId}${depType}${lag}`;
    }).filter(Boolean).join(', ');
}

export function buildTaskRows(tasks) {
    const nameToId = taskNameToIdMap(tasks);
    return tasks.map((task, index) => ({
        row: [
            index + 1,
            displayTaskName(task, true),
            task.start || '',
            task.finish || '',
            Number(task.duration_days || 0),
            task.resources || '',
            task.percent || '',
            task.is_summary ? '' : (task.rag || ''),
            task.priority || 'Low',
            task.bucket || '',
            taskDependencyString(nameToId, task),
            task.comment || '',
        ],
        task,
    }));
}

function addTasksSheet(workbook, parseResult) {
    const worksheet = workbook.addWorksheet('Tasks');
    worksheet.addRow(XL_TASK_HEADERS);
    setHeaderStyle(worksheet.getRow(1));

    buildTaskRows(parseResult.tasks || []).forEach(({ row, task }) => {
        const added = worksheet.addRow(row);
        if (task.is_summary) {
            added.eachCell((cell) => {
                cell.font = { ...(cell.font || {}), bold: true };
            });
        }
        const rag = xlRagColour(task.rag);
        const ragCell = added.getCell(8);
        if (rag && XL_RAG_FILLS[rag]) {
            ragCell.fill = solidFill(XL_RAG_FILLS[rag]);
            if (rag === 'red' || rag === 'blue' || rag === 'grey') {
                ragCell.font = fontStyle({ bold: true, color: 'FFFFFF' });
            }
        }
    });

    fitColumnsToContent(worksheet, XL_TASK_HEADERS.length, 50);
    return worksheet;
}

function buildMilestoneEntries(tasks) {
    const phaseDates = new Map();
    tasks.forEach((task) => {
        if (!task.phase) return;
        const start = parseDate(task.start);
        const finish = parseDate(task.finish);
        if (!phaseDates.has(task.phase)) {
            phaseDates.set(task.phase, { start, end: finish });
            return;
        }
        const current = phaseDates.get(task.phase);
        if (start && (!current.start || start < current.start)) current.start = start;
        if (finish && (!current.end || finish > current.end)) current.end = finish;
    });

    const milestones = [];
    phaseDates.forEach((dates, phase) => {
        milestones.push({ name: phase, type: 'Phase', date: dates.end });
    });
    tasks.forEach((task) => {
        if (task.is_summary) {
            milestones.push({ name: task.name || '', type: 'Summary', date: parseDate(task.finish) });
        }
        if (!task.is_summary && Number(task.duration_days || 0) === 0) {
            milestones.push({ name: task.name || '', type: 'Milestone', date: parseDate(task.start) });
        }
    });

    const seen = new Set();
    return milestones.filter((entry) => {
        const key = `${entry.name}::${formatDate(entry.date)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => {
        const aDate = a.date ? a.date.getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.date ? b.date.getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
    });
}

function calculateBaselineVariance(baselineFinish, milestoneDate) {
    if (!baselineFinish) return '';
    if (!milestoneDate) return 'New';
    const baselineDate = parseDate(baselineFinish);
    if (!baselineDate) return '';
    const diff = Math.round((milestoneDate.getTime() - baselineDate.getTime()) / 86400000);
    if (diff > 0) return `+${diff}`;
    return String(diff);
}

function addMilestonesSheet(workbook, parseResult) {
    const baselineItems = Array.isArray(parseResult.baseline_items) ? parseResult.baseline_items : [];
    const baselineLookup = new Map(baselineItems.map((item) => [item.name, item]));
    const hasBaseline = baselineItems.length > 0;
    const headers = hasBaseline
        ? [...XL_MILESTONE_BASE_HEADERS, ...XL_MILESTONE_BASELINE_HEADERS]
        : [...XL_MILESTONE_BASE_HEADERS];

    const worksheet = workbook.addWorksheet('Milestones');
    worksheet.addRow(headers);
    setHeaderStyle(worksheet.getRow(1));

    buildMilestoneEntries(parseResult.tasks || []).forEach((entry) => {
        const row = [entry.name, entry.type, formatDate(entry.date)];
        if (hasBaseline) {
            const baseline = baselineLookup.get(entry.name);
            const baselineFinish = baseline ? (baseline.finish || '') : '';
            row.push(baselineFinish);
            row.push(baseline ? calculateBaselineVariance(baselineFinish, entry.date) : 'New');
        }
        worksheet.addRow(row);
    });

    fitColumnsToContent(worksheet, headers.length, 50);
    return worksheet;
}

function addResourcesSheet(workbook, parseResult) {
    const tasks = (parseResult.tasks || []).filter((task) => task.start && task.finish && task.resources && !task.is_summary);
    if (tasks.length === 0) return null;

    const starts = tasks.map((task) => parseDate(task.start)).filter(Boolean);
    const finishes = tasks.map((task) => parseDate(task.finish)).filter(Boolean);
    if (starts.length === 0 || finishes.length === 0) return null;

    const startDate = new Date(Math.min(...starts.map((date) => date.getTime())));
    const finishDate = new Date(Math.max(...finishes.map((date) => date.getTime())));
    const dateRange = [];
    for (let current = new Date(startDate); current <= finishDate; current.setDate(current.getDate() + 1)) {
        dateRange.push(new Date(current));
    }

    const headers = ['Resource', ...dateRange.map((date) => `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${String(date.getDate()).padStart(2, '0')} ${date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase()}`)];
    const worksheet = workbook.addWorksheet('Resources');
    worksheet.addRow(headers);
    setHeaderStyle(worksheet.getRow(1));

    dateRange.forEach((date, index) => {
        const cell = worksheet.getRow(1).getCell(index + 2);
        if (date.getDay() === 0 || date.getDay() === 6) {
            cell.fill = solidFill('D3D3D3');
            cell.font = fontStyle({ bold: true, color: '000000' });
        }
    });

    const resourceDailyHours = {};
    tasks.forEach((task) => {
        const taskStart = parseDate(task.start);
        const taskFinish = parseDate(task.finish);
        const resources = splitResources(task.resources);
        if (!taskStart || !taskFinish || resources.length === 0) return;
        const taskDurationDays = Math.round((taskFinish.getTime() - taskStart.getTime()) / 86400000) + 1;
        const effortDays = Number(task.duration_days || 0);
        if (taskDurationDays <= 0) return;
        const hoursPerDay = (effortDays * 8.0) / taskDurationDays / resources.length;
        for (let current = new Date(taskStart); current <= taskFinish; current.setDate(current.getDate() + 1)) {
            const dateKey = formatDate(current);
            resources.forEach((resource) => {
                const key = resource.toLowerCase();
                if (!resourceDailyHours[key]) {
                    resourceDailyHours[key] = { display_name: resource, hours: {} };
                }
                resourceDailyHours[key].hours[dateKey] = (resourceDailyHours[key].hours[dateKey] || 0) + hoursPerDay;
            });
        }
    });

    Object.keys(resourceDailyHours).sort().forEach((resourceKey) => {
        const entry = resourceDailyHours[resourceKey];
        const row = [entry.display_name, ...dateRange.map((date) => {
            const hours = entry.hours[formatDate(date)] || 0;
            return hours > 0 ? Math.round(hours * 10) / 10 : '-';
        })];
        const added = worksheet.addRow(row);
        for (let column = 2; column <= headers.length; column += 1) {
            const cell = added.getCell(column);
            cell.alignment = { horizontal: 'center' };
            const date = dateRange[column - 2];
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            if (cell.value === '-') {
                if (isWeekend) cell.fill = solidFill('F5F5F5');
                continue;
            }
            const hours = Number(cell.value || 0);
            if (hours <= 4) {
                cell.fill = solidFill('E8F5E9');
                cell.font = fontStyle({ color: '2E7D32' });
            } else if (hours <= 8) {
                cell.fill = solidFill('FFF3E0');
                cell.font = fontStyle({ color: 'E65100' });
            } else {
                cell.fill = solidFill('FFEBEE');
                cell.font = fontStyle({ bold: true, color: 'C62828' });
            }
            if (isWeekend) {
                cell.fill = solidFill('F5F5F5');
            }
        }
    });

    fitColumnsToContent(worksheet, headers.length, 50);
    return worksheet;
}

function addBudgetSheet(workbook, items) {
    const budgetItems = Array.isArray(items) ? items : [];
    const worksheet = workbook.addWorksheet('Budget');
    worksheet.addRow(XL_BUDGET_HEADERS);
    setHeaderStyle(worksheet.getRow(1), '667EEA', { bold: true, color: 'FFFFFF', size: 11 }, null);

    budgetItems.forEach((item) => {
        const row = worksheet.addRow([
            item.id || '',
            item.description || '',
            Number(item.estimate || 0),
            Number(item.forecast || 0),
            item.type || '',
            item.invoice || '',
            item.po || '',
            item.supplier || '',
            Number(item.total || 0),
            item.date_ordered || '',
            item.date_received || '',
            item.category || '',
        ]);
        [3, 4, 9].forEach((column) => {
            row.getCell(column).numFmt = '#,##0.00';
        });
    });

    if (budgetItems.length > 0) {
        const totalRow = worksheet.addRow([
            '',
            'TOTALS',
            budgetItems.reduce((sum, item) => sum + Number(item.estimate || 0), 0),
            budgetItems.reduce((sum, item) => sum + Number(item.forecast || 0), 0),
            '', '', '', '',
            budgetItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
            '', '', '',
        ]);
        totalRow.getCell(2).font = fontStyle({ bold: true });
        [3, 4, 9].forEach((column) => {
            totalRow.getCell(column).font = fontStyle({ bold: true });
            totalRow.getCell(column).numFmt = '#,##0.00';
        });
    }

    XL_BUDGET_COLUMN_WIDTHS.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
    });
    return worksheet;
}

function styleRaidScoreCell(cell, score) {
    if (score >= 16) {
        cell.fill = solidFill('FFE0E0');
    } else if (score >= 6) {
        cell.fill = solidFill('FFF3BF');
    } else {
        cell.fill = solidFill('D3F9D8');
    }
}

function addRaidSheet(workbook, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const worksheet = workbook.addWorksheet('RAID Log');
    worksheet.addRow(XL_RAID_HEADERS);
    setHeaderStyle(worksheet.getRow(1), '667EEA', { bold: true, color: 'FFFFFF', size: 11 }, null);

    items.forEach((item) => {
        const row = worksheet.addRow([
            item.id || '',
            capitalize(item.type),
            item.title || '',
            item.description || '',
            item.raised_by || '',
            item.owner || '',
            item.mitigation_actions || '',
            item.impact || '',
            item.likelihood || '',
            item.score || 0,
            capitalize(item.status),
            item.priority || '',
            item.target_date || item.date || '',
        ]);
        styleRaidScoreCell(row.getCell(10), Number(item.score || 0));
    });

    XL_RAID_HEADERS.forEach((header, index) => {
        worksheet.getColumn(index + 1).width = XL_RAID_COLUMN_WIDTHS[header] || 15;
    });
    return worksheet;
}

function addStakeholdersSheet(workbook, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const worksheet = workbook.addWorksheet('Stakeholders');
    worksheet.addRow(XL_STAKEHOLDER_HEADERS);
    setHeaderStyle(worksheet.getRow(1), '667EEA', { bold: true, color: 'FFFFFF', size: 11 }, null);

    items.forEach((item) => {
        const row = worksheet.addRow([
            item.name || '',
            item.role || '',
            capitalize(item.interest || 'low'),
            capitalize(item.influence || 'low'),
        ]);
        [3, 4].forEach((column) => {
            const cell = row.getCell(column);
            const lower = String(cell.value || '').toLowerCase();
            cell.fill = solidFill(lower === 'high' ? 'FFE0E0' : 'D3F9D8');
        });
    });

    XL_STAKEHOLDER_COLUMN_WIDTHS.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
    });
    return worksheet;
}

export function calculateWorkbookEvm(tasks, budgetItems = [], now = new Date()) {
    if (!Array.isArray(tasks) || tasks.length === 0) return null;
    const workTasks = tasks.filter((task) => !task.is_summary && task.start && task.finish && Number(task.duration_days || 0) > 0);
    if (workTasks.length === 0) return null;

    let totalDurationDays = 0;
    let weightedComplete = 0;
    workTasks.forEach((task) => {
        const durationDays = Number(task.duration_days || 0);
        const percent = Number(task.percent || 0);
        totalDurationDays += durationDays;
        weightedComplete += durationDays * percent;
    });
    const overallPercentComplete = totalDurationDays > 0 ? weightedComplete / totalDurationDays : 0;

    const starts = workTasks.map((task) => parseDate(task.start)).filter(Boolean);
    const finishes = workTasks.map((task) => parseDate(task.finish)).filter(Boolean);
    if (starts.length === 0 || finishes.length === 0) return null;

    const projectStart = new Date(Math.min(...starts.map((date) => date.getTime())));
    const projectEnd = new Date(Math.max(...finishes.map((date) => date.getTime())));
    const rawProjectDays = Math.round((projectEnd.getTime() - projectStart.getTime()) / 86400000);
    const totalProjectDays = rawProjectDays > 0 ? rawProjectDays : 1;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rawElapsedDays = Math.round((today.getTime() - projectStart.getTime()) / 86400000);
    const elapsedDays = rawProjectDays > 0
        ? Math.max(0, rawElapsedDays)
        : (today >= projectStart ? 1 : 0);
    const timeElapsedFraction = Math.min(1.0, elapsedDays / totalProjectDays);

    let BAC = 0;
    let AC = 0;
    if (Array.isArray(budgetItems)) {
        budgetItems.forEach((item) => {
            BAC += Number(item.forecast || item.estimate || 0);
            AC += Number(item.total || 0);
        });
    }
    const hasBudgetData = BAC > 0;
    if (!hasBudgetData) {
        BAC = totalDurationDays;
        AC = totalDurationDays * (overallPercentComplete / 100.0);
    }

    const PV = BAC * timeElapsedFraction;
    const EV = BAC * (overallPercentComplete / 100.0);
    const CV = EV - AC;
    const SV = EV - PV;
    const CPI = AC !== 0 ? EV / AC : 0;
    const SPI = PV !== 0 ? EV / PV : 0;
    const EAC = CPI !== 0 ? BAC / CPI : BAC;
    const ETC = EAC - AC;
    const VAC = BAC - EAC;

    return {
        BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC,
        overall_percent_complete: overallPercentComplete,
        time_elapsed_fraction: timeElapsedFraction,
        project_start: projectStart,
        project_end: projectEnd,
        has_budget_data: hasBudgetData,
    };
}

function addEvmSheet(workbook, tasks, budgetItems, now) {
    const evm = calculateWorkbookEvm(tasks, budgetItems, now);
    if (!evm) return null;

    const worksheet = workbook.addWorksheet('EVM');
    worksheet.addRow(['Metric', 'Value']);
    setHeaderStyle(worksheet.getRow(1), '667EEA', { bold: true, color: 'FFFFFF', size: 11 }, null);

    const fmt = (value) => Math.round(Number(value) * 100) / 100;
    const fmtPct = (value) => `${Number(value).toFixed(1)}%`;
    const rows = [
        ['% Complete', fmtPct(evm.overall_percent_complete)],
        ['BAC (Budget at Completion)', fmt(evm.BAC)],
        ['PV (Planned Value)', fmt(evm.PV)],
        ['EV (Earned Value)', fmt(evm.EV)],
        ['AC (Actual Cost)', fmt(evm.AC)],
        ['CV (Cost Variance)', fmt(evm.CV)],
        ['SV (Schedule Variance)', fmt(evm.SV)],
        ['CPI (Cost Performance Index)', fmt(evm.CPI)],
        ['SPI (Schedule Performance Index)', fmt(evm.SPI)],
        ['EAC (Estimate at Completion)', fmt(evm.EAC)],
        ['ETC (Estimate to Complete)', fmt(evm.ETC)],
        ['VAC (Variance at Completion)', fmt(evm.VAC)],
        ['Project Start', formatDate(evm.project_start)],
        ['Project End', formatDate(evm.project_end)],
        ['Time Elapsed', fmtPct(evm.time_elapsed_fraction * 100)],
        ['Budget Data Available', evm.has_budget_data ? 'Yes' : 'No (using duration proxy)'],
    ];
    rows.forEach((rowData) => worksheet.addRow(rowData));

    for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex += 1) {
        const metricCell = worksheet.getRow(rowIndex).getCell(1);
        const valueCell = worksheet.getRow(rowIndex).getCell(2);
        const metric = String(metricCell.value || '');
        if (metric.startsWith('CV') || metric.startsWith('SV') || metric.startsWith('VAC')) {
            const value = Number(valueCell.value);
            if (!Number.isNaN(value)) valueCell.fill = solidFill(value >= 0 ? 'D3F9D8' : 'FFE0E0');
        } else if (metric.startsWith('CPI') || metric.startsWith('SPI')) {
            const value = Number(valueCell.value);
            if (!Number.isNaN(value)) valueCell.fill = solidFill(value >= 1 ? 'D3F9D8' : 'FFE0E0');
        }
    }

    worksheet.getColumn(1).width = 35;
    worksheet.getColumn(2).width = 25;
    return worksheet;
}

function addCommsSheet(workbook, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const worksheet = workbook.addWorksheet('Comms Plan');
    worksheet.addRow(XL_COMMS_HEADERS);
    setHeaderStyle(worksheet.getRow(1), '4A90D9', { bold: true, color: 'FFFFFF', size: 11 }, null);
    items.forEach((item, index) => {
        worksheet.addRow([
            item.id || index + 1,
            item.activity || '',
            item.audience || '',
            item.content || '',
            item.frequency || '',
            item.channel || '',
            item.owner || '',
            item.status || '',
        ]);
    });
    Object.entries(XL_COMMS_COLUMN_WIDTHS).forEach(([letter, width]) => {
        worksheet.getColumn(letter).width = width;
    });
    return worksheet;
}

function addLessonsSheet(workbook, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const worksheet = workbook.addWorksheet('Lessons Learned');
    worksheet.addRow(XL_LESSONS_HEADERS);
    setHeaderStyle(worksheet.getRow(1), '6F42C1', { bold: true, color: 'FFFFFF', size: 11 }, null);
    items.forEach((item, index) => {
        worksheet.addRow([
            item.id || index + 1,
            item.project_manager || '',
            item.project_type || '',
            item.technology || '',
            item.project_phase || '',
            item.area || '',
            item.impact_type || '',
            item.observation || '',
            item.impact || '',
            item.recommendations || '',
            item.date || '',
        ]);
    });
    Object.entries(XL_LESSONS_COLUMN_WIDTHS).forEach(([letter, width]) => {
        worksheet.getColumn(letter).width = width;
    });
    return worksheet;
}

export function buildDeliverablesData(tasks, resourceMap = {}, resourceRoles = {}, stakeholders = []) {
    const deliverables = (tasks || []).filter((task) => task.deliverable && (task.product_type || 'internal') !== 'group');
    if (deliverables.length === 0) return null;

    const reverseResourceMap = {};
    Object.entries(resourceMap || {}).forEach(([shortname, fullName]) => {
        reverseResourceMap[String(fullName || '').toLowerCase()] = shortname.toLowerCase();
    });
    const shortnameFor = (name) => reverseResourceMap[String(name || '').toLowerCase()] || String(name || '').toLowerCase();

    const people = {};
    (tasks || []).forEach((task) => {
        const qualityRoles = task.quality_roles || {};
        Object.keys(qualityRoles).forEach((name) => {
            const key = shortnameFor(name);
            if (!people[key]) people[key] = resourceMap[key] || name;
        });
        splitResources(task.resources).forEach((resource) => {
            const key = shortnameFor(resource);
            if (!people[key]) people[key] = resourceMap[key] || resource;
        });
    });
    Object.entries(resourceMap || {}).forEach(([shortname, fullName]) => {
        if (!people[shortname.toLowerCase()]) people[shortname.toLowerCase()] = fullName;
    });

    const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const cleanRole = (value) => String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part && !emailPattern.test(part))
        .join(', ');

    const roleMap = {};
    Object.entries(resourceRoles || {}).forEach(([shortname, role]) => {
        const cleaned = cleanRole(role);
        if (cleaned) roleMap[shortname.toLowerCase()] = cleaned;
    });
    (stakeholders || []).forEach((stakeholder) => {
        const key = shortnameFor(stakeholder.shortname || stakeholder.name || '');
        if (!key || roleMap[key] || !stakeholder.role) return;
        const cleaned = cleanRole(stakeholder.role);
        if (cleaned) roleMap[key] = cleaned;
    });

    const peopleList = Object.keys(people).sort();
    const items = deliverables.map((deliverableTask) => {
        const mergedRoles = {};
        const qualityRoles = deliverableTask.quality_roles || {};
        Object.entries(qualityRoles).forEach(([name, role]) => {
            mergedRoles[shortnameFor(name)] = role;
        });
        splitResources(deliverableTask.resources).forEach((resource) => {
            const key = shortnameFor(resource);
            if (!mergedRoles[key]) mergedRoles[key] = 'P';
        });
        const deliverableName = String(deliverableTask.name || '').toLowerCase();
        (tasks || []).forEach((task) => {
            if (String(task.parent || '').toLowerCase() !== deliverableName) return;
            Object.entries(task.quality_roles || {}).forEach(([name, role]) => {
                const key = shortnameFor(name);
                if (!mergedRoles[key]) mergedRoles[key] = role;
            });
            splitResources(task.resources).forEach((resource) => {
                const key = shortnameFor(resource);
                if (!mergedRoles[key]) mergedRoles[key] = 'P';
            });
        });
        const percent = Number(deliverableTask.percent || 0);
        return {
            name: String(deliverableTask.deliverable || deliverableTask.name || '').replace(/_/g, ' '),
            start: deliverableTask.start || '',
            finish: deliverableTask.finish || '',
            status: percent === 100 ? 'Complete' : (percent > 0 ? 'In Progress' : ''),
            roles: mergedRoles,
        };
    });

    return { items, people: peopleList, role_map: roleMap };
}

function addDeliverablesSheet(workbook, parseResult) {
    const data = buildDeliverablesData(
        parseResult.tasks || [],
        parseResult.resource_map || {},
        parseResult.resource_roles || {},
        parseResult.stakeholders || []
    );
    if (!data) return null;

    const worksheet = workbook.addWorksheet('Deliverables Matrix');
    const fixedHeaders = ['ID', 'Deliverable', 'Dates', 'Status'];
    const personHeaders = data.people.map((shortname) => data.role_map[shortname] || shortname);
    const headers = [...fixedHeaders, ...personHeaders, 'QA'];
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
    headerRow.height = 80;
    headerRow.eachCell((cell, columnNumber) => {
        cell.fill = solidFill('366092');
        cell.font = fontStyle({ bold: true, color: 'FFFFFF', size: 10 });
        if (columnNumber > fixedHeaders.length && columnNumber <= fixedHeaders.length + personHeaders.length) {
            cell.alignment = { textRotation: 90, horizontal: 'center', vertical: 'bottom' };
        } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
    });

    const roleFills = { P: '4472C4', R: 'ED7D31', A: '70AD47' };
    data.items.forEach((item, index) => {
        const start = item.start ? formatDate(parseDate(item.start)) : '';
        const finish = item.finish ? formatDate(parseDate(item.finish)) : '';
        const dates = start && finish ? `${start} – ${finish}` : start;
        const row = worksheet.addRow([index + 1, item.name, dates, item.status, ...data.people.map((shortname) => item.roles[shortname] || ''), '']);
        if (item.status === 'Complete') {
            row.getCell(4).fill = solidFill('70AD47');
            row.getCell(4).font = fontStyle({ color: 'FFFFFF' });
        } else if (item.status === 'In Progress') {
            row.getCell(4).fill = solidFill('FFC000');
        }

        const roleLetters = [];
        data.people.forEach((shortname, offset) => {
            const role = item.roles[shortname];
            if (!role) return;
            roleLetters.push(role);
            const cell = row.getCell(fixedHeaders.length + offset + 1);
            if (roleFills[role]) {
                cell.fill = solidFill(roleFills[role]);
                cell.font = fontStyle({ bold: true, color: 'FFFFFF' });
            }
            cell.alignment = { horizontal: 'center' };
        });

        const qaCell = row.getCell(headers.length);
        qaCell.alignment = { horizontal: 'center' };
        if (roleLetters.includes('P') && roleLetters.includes('R') && roleLetters.includes('A')) {
            qaCell.value = '✓';
            qaCell.fill = solidFill('70AD47');
            qaCell.font = fontStyle({ bold: true, color: 'FFFFFF' });
        }
    });

    worksheet.getColumn(1).width = 5;
    worksheet.getColumn(2).width = 25;
    worksheet.getColumn(3).width = 24;
    worksheet.getColumn(4).width = 12;
    data.people.forEach((_person, index) => {
        worksheet.getColumn(fixedHeaders.length + index + 1).width = 4;
    });
    worksheet.getColumn(headers.length).width = 5;
    return worksheet;
}

function addSummarySheet(workbook, parseResult, projectName, now) {
    const frontMatter = parseResult.front_matter || {};
    if (!frontMatter || Object.keys(frontMatter).length === 0) return null;
    const tasks = parseResult.tasks || [];
    const leafTasks = tasks.filter((task) => !task.is_summary);
    const percentComplete = leafTasks.length
        ? Math.round(leafTasks.reduce((sum, task) => sum + Number(task.percent || 0), 0) / leafTasks.length)
        : 0;

    const worksheet = workbook.addWorksheet('Summary');
    [
        ['Project Name', frontMatter.title || projectName || parseResult.project_name || 'Project'],
        ['Version', frontMatter.version || ''],
        ['Start Date', frontMatter['start date'] || frontMatter.start || ''],
        ['Project Manager', frontMatter['project manager'] || frontMatter.pm || ''],
        ['Budget', frontMatter.budget || ''],
        ['Sponsor', frontMatter.sponsor || ''],
        ['Percentage Complete', percentComplete / 100.0],
        ['Date Exported', formatDateTimeLocal(now)],
    ].forEach((row) => worksheet.addRow(row));

    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const labelCell = worksheet.getRow(rowIndex).getCell(1);
        const valueCell = worksheet.getRow(rowIndex).getCell(2);
        labelCell.fill = solidFill('366092');
        labelCell.font = fontStyle({ bold: true, color: 'FFFFFF', size: 11 });
        labelCell.alignment = { horizontal: 'right' };
        valueCell.font = fontStyle({ size: 11 });
        if (labelCell.value === 'Percentage Complete') {
            valueCell.numFmt = '0%';
        }
    }
    worksheet.getColumn(1).width = 20;
    worksheet.getColumn(2).width = 35;
    return worksheet;
}

export async function createPlanWorkbook(parseResult, options = {}) {
    const ExcelJS = options.ExcelJS || await ensureExcelJsLoaded();
    const workbook = new ExcelJS.Workbook();
    const now = options.now instanceof Date ? options.now : new Date();
    const projectName = options.projectName || parseResult.project_name || 'Project';
    const budgetItems = Array.isArray(options.budgetItems) ? options.budgetItems : [];

    addSummarySheet(workbook, parseResult, projectName, now);
    addTasksSheet(workbook, parseResult);
    addMilestonesSheet(workbook, parseResult);
    addResourcesSheet(workbook, parseResult);
    addBudgetSheet(workbook, budgetItems);
    addRaidSheet(workbook, parseResult.raid_items || []);
    addStakeholdersSheet(workbook, parseResult.stakeholders || []);
    addEvmSheet(workbook, parseResult.tasks || [], budgetItems, now);
    addCommsSheet(workbook, parseResult.comms_items || []);
    addLessonsSheet(workbook, parseResult.lessons_items || []);
    addDeliverablesSheet(workbook, parseResult);
    return workbook;
}

function elapsedSince(started) {
    return Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
}

export async function createPlanWorkbookBufferInWorker(parseResult, options = {}) {
    const worker = new Worker(BROWSER_EXCEL_WORKER_URL);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            worker.terminate();
            callback(value);
        };
        const timeout = setTimeout(() => {
            finish(reject, new Error('Browser Excel worker timed out while loading ExcelJS'));
        }, options.workerTimeoutMs ?? EXCELJS_LOAD_TIMEOUT_MS);

        worker.onmessage = (event) => {
            if (event.data && event.data.error) {
                finish(reject, new Error(event.data.error));
                return;
            }
            finish(resolve, event.data.buffer);
        };
        worker.onerror = (event) => {
            finish(reject, new Error(event.message || 'Browser Excel worker failed'));
        };
        try {
            worker.postMessage({
                parseResult,
                options: {
                    projectName: options.projectName || null,
                    budgetItems: Array.isArray(options.budgetItems) ? options.budgetItems : [],
                    now: options.now instanceof Date ? options.now.toISOString() : null,
                },
                excelJsUrl: EXCELJS_URL,
            });
        } catch (error) {
            finish(reject, error);
        }
    });
}

export async function exportPlanExcelInBrowser(parseResult, options = {}) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const filename = options.filename || `${options.projectName || parseResult.project_name || 'Project'}.xlsx`;
    let workbook = null;
    let buffer;
    let worker = false;

    if (!options.ExcelJS && typeof Worker !== 'undefined') {
        buffer = await createPlanWorkbookBufferInWorker(parseResult, options);
        worker = true;
    } else {
        workbook = await createPlanWorkbook(parseResult, options);
        buffer = await workbook.xlsx.writeBuffer();
    }

    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    return { filename, workbook, worker, elapsedMs: elapsedSince(started) };
}

export function buildTaskCsv(parseResult) {
    const rows = [
        ['ID', 'Task Name', 'Start', 'Finish', 'Duration (days)', 'Resources', '% Complete', 'RAG', 'Priority', 'Bucket', 'Comment'],
        ...(parseResult.tasks || []).map((task, index) => [
            index + 1,
            displayTaskName(task, false),
            task.start || '',
            task.finish || '',
            Number(task.duration_days || 0),
            task.resources || '',
            task.percent || 0,
            task.rag || 'N/A',
            task.priority || 'Low',
            task.bucket || '',
            task.comment || '',
        ]),
    ];
    return rows.map((row) => row.map((value) => {
        const text = String(value == null ? '' : value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')).join('\n');
}

export async function exportPlanCsvInBrowser(parseResult, options = {}) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const filename = options.filename || `${options.projectName || parseResult.project_name || 'Project'}.csv`;
    const csv = buildTaskCsv(parseResult);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
    return { filename, csv, elapsedMs: elapsedSince(started) };
}

export async function createRaidWorkbook(items, options = {}) {
    const ExcelJS = options.ExcelJS || await ensureExcelJsLoaded();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('RAID Log');
    worksheet.addRow(XL_RAID_ROUTE_HEADERS);
    setHeaderStyle(worksheet.getRow(1), '667EEA', { bold: true, color: 'FFFFFF', size: 11 }, null);
    (items || []).forEach((item) => {
        const row = worksheet.addRow([
            item.id || '',
            capitalize(item.type),
            item.title || '',
            item.description || '',
            item.raised_by || '',
            item.owner || '',
            item.mitigation_actions || '',
            item.impact || '',
            item.likelihood || '',
            item.score || 0,
            capitalize(item.status),
        ]);
        styleRaidScoreCell(row.getCell(10), Number(item.score || 0));
    });
    [6, 14, 25, 35, 15, 15, 35, 10, 12, 8, 14].forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
    });
    return workbook;
}

/**
 * `options.download` (default true) triggers the usual anchor-click
 * download. Pass `download: false` when the caller is about to write the
 * buffer straight to a linked FileSystemFileHandle instead (issue #761's
 * sync-file-linking follow-up) — the buffer is always returned either way.
 */
export async function exportRaidExcelInBrowser(items, options = {}) {
    const workbook = await createRaidWorkbook(items, options);
    const filename = options.filename || `${options.projectName || 'Project'}-raid.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    if (options.download !== false) {
        downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    }
    return { filename, workbook, buffer };
}

export async function createBudgetWorkbook(items, options = {}) {
    const ExcelJS = options.ExcelJS || await ensureExcelJsLoaded();
    const workbook = new ExcelJS.Workbook();
    addBudgetSheet(workbook, items || []);
    return workbook;
}

export async function exportBudgetExcelInBrowser(items, options = {}) {
    const workbook = await createBudgetWorkbook(items, options);
    const filename = options.filename || `${options.projectName || 'Project'}-budget.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    return { filename, workbook };
}

async function loadWorkbookInput(input, options = {}) {
    const ExcelJS = options.ExcelJS || await ensureExcelJsLoaded();
    const workbook = new ExcelJS.Workbook();
    if (!input) {
        throw new Error('No file provided');
    }
    let bytes;
    if (typeof input.arrayBuffer === 'function') {
        bytes = await input.arrayBuffer();
    } else if (input instanceof ArrayBuffer) {
        bytes = input;
    } else if (ArrayBuffer.isView(input)) {
        bytes = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    } else {
        throw new Error('Unsupported workbook input');
    }
    await workbook.xlsx.load(bytes);
    return workbook;
}

export async function importRaidExcelInBrowser(input, options = {}) {
    const workbook = await loadWorkbookInput(input, options);
    const worksheet = workbook.worksheets[0];
    const headers = worksheet.getRow(1).values.slice(1).map((value) => String(value || '').toLowerCase().trim());
    const fieldNames = {
        'id': 'id',
        'type': 'type',
        'title': 'title',
        'description': 'description',
        'raised by': 'raised_by',
        'owner': 'owner',
        'mitigation actions': 'mitigation_actions',
        'impact': 'impact',
        'likelihood': 'likelihood',
        'score': 'score',
        'status': 'status',
    };
    const colMap = {};
    headers.forEach((header, index) => {
        if (fieldNames[header]) colMap[fieldNames[header]] = index;
    });
    const validTypes = new Set(['risk', 'action', 'issue', 'decision', 'dependency']);
    const validStatuses = new Set(['open', 'closed', 'transferred']);
    const items = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values.slice(1);
        if (!values.some((value) => value !== null && value !== undefined && value !== '')) return;
        const getCell = (field, defaultValue = '') => {
            const index = colMap[field];
            const value = index !== undefined ? values[index] : undefined;
            return value !== undefined && value !== null ? value : defaultValue;
        };
        let status = String(getCell('status', 'open')).toLowerCase().trim();
        if (status === 'transferred to issue') status = 'transferred';
        const impact = Math.max(1, Math.min(5, parseInt(getCell('impact', 3), 10) || 3));
        const likelihood = Math.max(1, Math.min(5, parseInt(getCell('likelihood', 3), 10) || 3));
        const type = String(getCell('type', 'risk')).toLowerCase().trim();
        items.push({
            id: parseInt(getCell('id', items.length + 1), 10) || (items.length + 1),
            type: validTypes.has(type) ? type : 'risk',
            title: String(getCell('title', '')),
            description: String(getCell('description', '')),
            raised_by: String(getCell('raised_by', '')),
            owner: String(getCell('owner', '')),
            mitigation_actions: String(getCell('mitigation_actions', '')),
            impact,
            likelihood,
            score: impact * likelihood,
            status: validStatuses.has(status) ? status : 'open',
        });
    });
    return { items };
}

export async function importBudgetExcelInBrowser(input, options = {}) {
    const workbook = await loadWorkbookInput(input, options);
    const worksheet = workbook.worksheets[0];
    const headers = worksheet.getRow(1).values.slice(1).map((value) => String(value || '').toLowerCase().trim());
    const fieldNames = {
        'id': 'id',
        'description': 'description',
        'estimate': 'estimate',
        'forecast': 'forecast',
        'type': 'type',
        'invoice': 'invoice',
        'po': 'po',
        'supplier': 'supplier',
        'total': 'total',
        'ordered': 'date_ordered',
        'date ordered': 'date_ordered',
        'received': 'date_received',
        'date received': 'date_received',
        'category': 'category',
    };
    const colMap = {};
    headers.forEach((header, index) => {
        const normalized = String(header || '').replace(/\s+/g, ' ').trim();
        const field = fieldNames[normalized];
        if (field && colMap[field] === undefined) {
            colMap[field] = index;
        }
    });
    const validTypes = new Set(['Capex', 'Opex', 'One-off']);
    const validCategories = new Set(['Consultancy', 'Resource', 'Travel', 'Infrastructure', 'Hardware', 'Software']);
    const items = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values.slice(1);
        if (!values.some((value) => value !== null && value !== undefined && value !== '')) return;
        const getCell = (field, defaultValue = '') => {
            const index = colMap[field];
            const value = index !== undefined ? values[index] : undefined;
            return value !== undefined && value !== null ? value : defaultValue;
        };
        const description = String(getCell('description', ''));
        if (!description || ['TOTALS', 'TOTAL'].includes(description.toUpperCase())) return;
        const safeFloat = (value, defaultValue = 0) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : defaultValue;
        };
        const type = String(getCell('type', 'Capex'));
        const category = String(getCell('category', 'Consultancy'));
        const normaliseDateCell = (value) => {
            if (value instanceof Date) return formatExcelDateCell(value);
            return String(value || '');
        };
        items.push({
            id: parseInt(getCell('id', items.length + 1), 10) || (items.length + 1),
            description,
            estimate: safeFloat(getCell('estimate', 0)),
            forecast: safeFloat(getCell('forecast', 0)),
            type: validTypes.has(type) ? type : 'Capex',
            invoice: String(getCell('invoice', '')),
            po: String(getCell('po', '')),
            supplier: String(getCell('supplier', '')),
            total: safeFloat(getCell('total', 0)),
            date_ordered: normaliseDateCell(getCell('date_ordered', '')),
            date_received: normaliseDateCell(getCell('date_received', '')),
            category: validCategories.has(category) ? category : 'Consultancy',
        });
    });
    return { items };
}

export function formatExcelDateCell(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export async function createBenefitsWorkbook(items, options = {}) {
    const ExcelJS = options.ExcelJS || await ensureExcelJsLoaded();
    const workbook = new ExcelJS.Workbook();
    const mapSheet = workbook.addWorksheet('Benefits Map');
    const mapHeaders = [
        'ID', 'Type', 'Title', 'Description', 'Objective Type',
        'Target Value', 'Current Value', 'Target Date', 'Measurement',
        'Linked To', 'Contribution %', 'Status', 'Last Updated', 'Score'
    ];
    mapSheet.addRow(mapHeaders);
    setHeaderStyle(mapSheet.getRow(1), '3B82F6', { bold: true, color: 'FFFFFF', size: 11 });
    (items || []).forEach((item) => {
        mapSheet.addRow([
            item.id || '',
            capitalize(item.type),
            item.title || '',
            item.description || '',
            item.objectiveType || '',
            item.targetValue || '',
            item.currentValue || '',
            item.targetDate || '',
            item.measurementMethod || '',
            Array.isArray(item.linkedTo) ? item.linkedTo.join(', ') : '',
            item.contributionPercent || 0,
            item.status || '',
            item.lastUpdated || '',
            item.score || 0,
        ]);
    });
    [6, 14, 25, 35, 16, 14, 14, 14, 20, 12, 14, 16, 14, 10].forEach((width, index) => {
        mapSheet.getColumn(index + 1).width = width;
    });

    const trackingSheet = workbook.addWorksheet('Tracking');
    const trackingHeaders = [
        'ID', 'Type', 'Title', 'Target Value', 'Current Value',
        'Target Date', 'Measurement', 'Status', 'Last Updated'
    ];
    trackingSheet.addRow(trackingHeaders);
    setHeaderStyle(trackingSheet.getRow(1), '3B82F6', { bold: true, color: 'FFFFFF', size: 11 });
    (items || []).forEach((item) => {
        if (!['benefit', 'disbenefit'].includes(item.type)) return;
        trackingSheet.addRow([
            item.id || '',
            capitalize(item.type),
            item.title || '',
            item.targetValue || '',
            item.currentValue || '',
            item.targetDate || '',
            item.measurementMethod || '',
            item.status || '',
            item.lastUpdated || '',
        ]);
    });
    [6, 14, 25, 16, 16, 14, 20, 16, 14].forEach((width, index) => {
        trackingSheet.getColumn(index + 1).width = width;
    });
    return workbook;
}

export async function exportBenefitsExcelInBrowser(items, options = {}) {
    const workbook = await createBenefitsWorkbook(items, options);
    const filename = options.filename || `${options.projectName || 'Benefits'}-benefits.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    return { filename, workbook };
}
