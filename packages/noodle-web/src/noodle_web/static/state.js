/**
 * state.js — Centralised global state for NoodlePlanner.
 * Must be loaded before all other script files.
 */

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
let detailedTimelineEnabled = false;
let minimalTimelineEnabled = false;

// Gantt state
let ganttTasks = [];
let ganttScale = 'days';
let ganttMinDate = null;
let ganttMaxDate = null;
let ganttPixelsPerDay = 14;
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

const RAID_LOG_START = '---raid log---';
const COMMS_START = '---comms---';
const BASELINE_START = '---baseline---';
const BENEFITS_START = '---benefits---';
const LESSONS_START = '---lessons learned---';

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
const PLAN_VIEWS = ['project-report', 'tasks', 'gantt', 'kanban', 'calendar', 'milestones', 'timeline', 'mindmap', 'pbs', 'deliverables', 'product-flow', 'benefits', 'guide'];
const TRACKING_VIEWS = ['raid', 'actions', 'highlights', 'lookahead', 'analysis', 'budget', 'evm', 'comms'];
const RESOURCES_VIEWS = ['resources', 'timesheet', 'user-workload', 'resource-sheet', 'stakeholders'];
const TOOLS_VIEWS = ['guide'];

// All project views now live under a single planSubnav bar
const ALL_PROJECT_VIEWS = [...PLAN_VIEWS, ...TRACKING_VIEWS, ...RESOURCES_VIEWS];

const SUBNAV_GROUPS = [
    { id: 'planSubnav', views: ALL_PROJECT_VIEWS }
];
