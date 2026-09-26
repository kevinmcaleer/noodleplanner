/**
 * state.js — Centralised global state for NoodlePlanner.
 * Must be loaded before all other script files.
 */

// The one global escapeHtml(). Declared here, in the first script both
// index.html and collab_join.html load, because a top-level function in a
// classic script is shared by -- and silently replaced for -- every file:
// a second copy anywhere later wins for all callers. It escapes quotes as
// well as & < >, so its result is safe in a quoted attribute value
// (title="...", data-*="...") as well as in element text.
function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// A value for a single-quoted JS string inside an event-handler attribute,
// onclick="f('...')". The browser decodes the attribute's entities before
// it runs the handler, so escapeHtml() alone hands the JS a bare ': escape
// for the string first, then for the attribute.
function escapeJsAttr(value) {
    return escapeHtml(String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n'));
}

// Core state
let selectedFile = null;
let renderTimeout = null;
let globalResourceMap = {}; // Maps shortnames to full names from backend
let globalResourceDetails = {}; // Maps shortnames to { name, role } from front matter
let lastRenderedTasks = []; // Cache of backend-calculated tasks from last render
let lastParseResult = null; // { result, planText } of the last /api/parse; the .mpp exporter builds from this

// Track which section the resource form was opened from (for returning to it)
let resourceFormReturnSection = null;

// Detail pane timer for close transition
let closeDetailPaneTimer = null;

// Timeline state
let timelineTasks = [];
let timelineProjectName = '';
let timelineNeedsVisibleRender = false;
let detailedTimelineEnabled = false;
let minimalTimelineEnabled = false;

// Gantt state
let ganttTasks = [];
let ganttScale = 'days';
let ganttMinDate = null;
let ganttMaxDate = null;
// The zoom (#787): the one number the chart is drawn from. Starts on the
// Days detent, which is what the zoom control shows before any render.
let ganttPixelsPerDay = 28;
let collapsedSummaryTasks = new Set();

// Task form state
let currentTask = null;
let userSetStartDate = false;
let userSetFinishDate = false;
let userSetDuration = false;

// Autocomplete state
let autocompleteSelectedIndex = -1;
let resourceAutocompleteSelectedIndex = -1;
let dependencyAutocompleteSelectedIndex = -1;
let currentDependencyInput = null;
let labelAutocompleteSelectedIndex = -1;
let projectLabelAutocompleteSelectedIndex = -1;

// Templates state
let templatesData = null;
let currentCategory = 'all';

// Resizer state
let isResizing = false;
let startX = 0;
let startWidth = 0;

// Gantt splitter state
let isGanttResizing = false;
let ganttStartX = 0;
let ganttStartWidth = 0;

// Editor splitter state
let isEditorResizing = false;
let editorStartX = 0;
let editorStartWidth = 0;
const EDITOR_DEFAULT_WIDTH_PERCENT = 35;
const EDITOR_MIN_WIDTH = 200;

// Resource form debounce
let resourceDebounceTimer = null;

// Project details debounce
let projectDetailsDebounceTimer = null;

// Conditional formatting
let conditionalFormattingRules = [];
let cfActivePickerRowIndex = null;

const CF_PASTEL_COLOURS = [
    '#FFE0B2', '#FFCCBC', '#F8BBD0', '#E1BEE7', '#D1C4E9',
    '#C5CAE9', '#BBDEFB', '#B3E5FC', '#B2EBF2', '#B2DFDB',
    '#C8E6C9', '#DCEDC8', '#F0F4C3', '#FFF9C4', '#FFECB3',
    '#D7CCC8', '#F5F5F5', '#CFD8DC'
];

const CF_DARK_COLOURS = [
    '#E65100', '#BF360C', '#880E4F', '#4A148C', '#311B92',
    '#1A237E', '#0D47A1', '#01579B', '#006064', '#004D40',
    '#1B5E20', '#33691E', '#827717', '#F57F17', '#FF6F00',
    '#3E2723', '#212121', '#263238'
];

// RAID state
let raidItems = [];
let raidNextId = 1;
let raidSortColumn = 'id';
let raidSortAsc = true;
let raidItemPendingDeleteId = null;
let raidEditorIsUpdating = false;
let raidEditorDebounceTimer = null;

// RAID <-> Excel sync review state (issue #761)
let raidSyncPendingEntries = [];
let raidSyncPendingChoices = {};
let raidSyncPendingFilename = '';

// Excel wizard state
let excelWizardFile = null;
let excelWizardData = null;
let excelWizardStep = 1;

// Calendar state
let calendarCurrentMonth = new Date().getMonth();
let calendarCurrentYear = new Date().getFullYear();
let calendarTasks = [];

// Budget state
let budgetItems = [];
let budgetNextId = 1;
let budgetSortColumn = 'id';
let budgetSortAsc = true;
let budgetEditorIsUpdating = false;
let budgetEditorDebounceTimer = null;
let budgetSheetInstance = null;
let budgetSheetViewActive = false;
// Category/Type filters shown in the spreadsheet view's own column headers
// (#1119) -- the toolbar's Category/Type filters are hidden while the
// spreadsheet view is active, so these keep filtering available there.
let budgetSheetCategoryFilter = 'all';
let budgetSheetTypeFilter = 'all';
let budgetItemPendingDeleteId = null;
let agreedBudget = 0;

const BUDGET_START = '---budget---';
const BUDGET_TYPES = ['Capex', 'Opex', 'One-off'];
const BUDGET_CATEGORIES = ['Consultancy', 'Resource', 'Travel', 'Infrastructure', 'Hardware', 'Software'];

const BUDGET_DBML = `Table budget_items {
  description text
  estimate number [format: currency]
  forecast number [format: currency]
  type enum('Capex','Opex','One-off')
  invoice_number text
  po_number text
  supplier text
  total number [format: currency]
  date_ordered date
  date_received date
  category enum('Consultancy','Resource','Travel','Infrastructure','Hardware','Software')
}`;

// HIGHLIGHTS_START/HIGHLIGHTS_END have no top-level (truly global)
// declaration elsewhere in the static bundle: every script.js caller
// re-declares HIGHLIGHTS_START locally inside its own function (see
// mergeDuplicateSections() and friends), and the only existing
// HIGHLIGHTS_END lives inside msproject-sync.js's *module* scope (it has
// `export`s, so it is loaded via dynamic import(), never as a classic
// <script>, and never shares global scope with script.js). That worked
// for those call sites, but left extractWhiteboardFromPlanText() /
// updatePlanWhiteboardText() (script.js, issue #844) throwing a
// ReferenceError the first time anything actually called them in a real
// browser (masked in tests/test_whiteboard_backmatter.mjs, which seeds
// both constants directly into its vm sandbox). Declared here, top-level,
// alongside their sibling section markers, so they resolve the same way
// WHITEBOARD_START and friends already do (fixed while wiring up #846's
// whiteboard notes, which are the first real callers from outside
// script.js itself).
const HIGHLIGHTS_START = '---highlights---';
const HIGHLIGHTS_END = '---end-highlights---';
const RAID_LOG_START = '---raid log---';
const COMMS_START = '---comms---';
const BASELINE_START = '---baseline---';
const BENEFITS_START = '---benefits---';
const LESSONS_START = '---lessons learned---';
const WHITEBOARD_START = '---whiteboard---';
// Issue #1019: the "good idea, not now" parking lot, canonically the
// section *after* whiteboard -- see format_converter.py's matching
// ALL_SECTION_MARKERS comment for the full canonical order.
const PARKING_LOT_START = '---parking lot---';
// Issue #1053: three-point (PERT) estimate inputs per task, canonically
// the last back-matter section -- see format_converter.py's matching
// ALL_SECTION_MARKERS comment.
const ESTIMATES_START = '---estimates---';

// Benefits state
let benefitItems = [];
let benefitNextId = 1;
let benefitConnections = [];
let benefitTrackingRows = [];

// Comms Plan state
let commsItems = [];
let commsNextId = 1;
let commsSortColumn = 'id';
let commsSortAsc = true;
let commsItemPendingDeleteId = null;
let baselineItems = [];
// The plan's working-day test, (dayNumber) => boolean, from its calendar and
// non-working days; set on each parse from engine/local-parse.js
// projectWorkingDay. The reports (#776) count variance in these days.
let projectIsWorkingDay = null;
// Baseline history (issue #1112): metadata (id/name/date) for every baseline
// created via the Baseline dialog, most recent first. Only the most recent
// non-cleared entry has real task data behind it -- that data lives in
// baselineItems above, and activeBaselineId names which history entry it
// belongs to (null once the active baseline has been cleared). See
// format_converter.py's generate_baseline_history_comment() for how this is
// round-tripped through the plan text's ---baseline--- section.
let baselineHistory = [];
let activeBaselineId = null;

// Lessons Learned state (issue #598)
let lessonsItems = [];
let lessonsNextId = 1;
let lessonsSortColumn = 'id';
let lessonsSortAsc = true;
let lessonsItemPendingDeleteId = null;
const LESSONS_IMPACT_TYPES = ['Went Well', 'Needs to Change', 'Mixed'];
const LESSONS_AREAS = [
    'Quality', 'Resource Plans', 'Schedule', 'Cost', 'Scope',
    'Communication', 'Risk', 'Stakeholders', 'Procurement',
    'Technology', 'Process', 'Team', 'Other'
];
const LESSONS_PHASES = [
    'Initiation', 'Planning', 'Delivery', 'Closure', 'Post-Project'
];

// Stakeholder state
let stakeholderItems = [];
let stakeholderNextId = 1;

// Highlights state
let highlightsData = [];

// Actions state
let actionsSortColumn = 'id';
let actionsSortAsc = true;

// AI chat state
let aiChatOpen = false;
let aiChatHistory = [];

// Keyboard shortcut state
let pendingGoKey = false;
let goKeyTimeout = null;

// Navigation constants
const PLAN_VIEWS = ['project-report', 'tasks', 'notepad', 'gantt', 'kanban', 'calendar', 'milestones', 'timeline', 'mindmap', 'whiteboard', 'pbs', 'deliverables', 'product-flow', 'benefits', 'guide', 'assignments', 'slippage'];
const TRACKING_VIEWS = ['raid', 'actions', 'highlights', 'lookahead', 'escalations', 'analysis', 'budget', 'evm', 'forecast', 'comms'];
const RESOURCES_VIEWS = ['resources', 'timesheet', 'user-workload', 'resource-sheet', 'stakeholders'];
const TOOLS_VIEWS = ['guide'];

// All project views now live under a single planSubnav bar
const ALL_PROJECT_VIEWS = [...PLAN_VIEWS, ...TRACKING_VIEWS, ...RESOURCES_VIEWS];

const SUBNAV_GROUPS = [
    { id: 'planSubnav', views: ALL_PROJECT_VIEWS }
];

// MS Project sync review state (issue #842)
let mspSyncPendingCurrentText = '';
let mspSyncPendingImportedMarkdown = '';
let mspSyncPendingFilename = '';
let mspSyncPendingDiff = null;
let mspSyncPendingChoices = {};
