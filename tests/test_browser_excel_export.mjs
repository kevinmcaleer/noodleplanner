import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

import {
  EXCELJS_CDN_URL,
  XL_TASK_HEADERS,
  XL_BUDGET_HEADERS,
  XL_RAID_HEADERS,
  XL_STAKEHOLDER_HEADERS,
  XL_COMMS_HEADERS,
  XL_LESSONS_HEADERS,
  buildTaskCsv,
  buildDeliverablesData,
  createBenefitsWorkbook,
  createBudgetWorkbook,
  createPlanWorkbook,
  createRaidWorkbook,
  calculateWorkbookEvm,
  importBudgetExcelInBrowser,
  importRaidExcelInBrowser,
  xlRagColour,
} from '../packages/noodle-web/src/noodle_web/static/browser-excel.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function sampleParseResult() {
  return {
    project_name: 'Browser Export',
    front_matter: {
      title: 'Browser Export',
      version: '1.2',
      'start date': '2026-01-01',
      'project manager': 'Jane Doe',
      budget: '100',
      sponsor: 'Acme',
    },
    resource_map: {
      jd: 'Jane Doe',
      qa: 'Quinn QA',
      ap: 'Alice Approver',
    },
    resource_roles: {
      jd: 'Producer',
      qa: 'Reviewer, qa@example.com',
      ap: 'Approver',
    },
    tasks: [
      {
        id: 1,
        key: 'Phase 1',
        name: 'Phase 1',
        start: '2026-01-01',
        finish: '2026-01-06',
        duration_days: 4,
        resources: '',
        percent: 0,
        rag: '',
        priority: 'Low',
        bucket: '',
        level: 0,
        is_summary: true,
        phase: 'Phase 1',
        depends: [],
      },
      {
        id: 2,
        key: 'Deliverable A',
        name: 'Deliverable_A',
        start: '2026-01-01',
        finish: '2026-01-03',
        duration_days: 2,
        resources: 'Jane Doe',
        percent: 100,
        rag: 'Completed',
        priority: 'High',
        bucket: 'Track A',
        level: 1,
        is_summary: false,
        phase: 'Phase 1',
        depends: [],
        deliverable: 'Deliverable_A',
        quality_roles: { qa: 'R', ap: 'A' },
      },
      {
        id: 3,
        key: 'Build',
        name: 'Build',
        parent: 'Deliverable_A',
        start: '2026-01-01',
        finish: '2026-01-03',
        duration_days: 2,
        resources: 'Jane Doe',
        percent: 100,
        rag: 'Completed',
        priority: 'Medium',
        bucket: 'Track A',
        level: 2,
        is_summary: false,
        phase: 'Phase 1',
        depends: ['Go Live'],
        quality_roles: {},
      },
      {
        id: 4,
        key: 'Go Live',
        name: 'Go Live',
        start: '2026-01-04',
        finish: '2026-01-06',
        duration_days: 1,
        resources: 'Jane Doe',
        percent: 50,
        rag: 'Behind Schedule',
        priority: 'Low',
        bucket: 'Track B',
        level: 1,
        is_summary: false,
        phase: 'Phase 1',
        depends: ['Deliverable A'],
        dependency_types: { 'Deliverable A': 'SS' },
        lag_lead: { 'Deliverable A': '+1d' },
      },
    ],
    baseline_items: [
      { name: 'Phase 1', finish: '2026-01-05' },
      { name: 'Go Live', finish: '2026-01-06' },
    ],
    raid_items: [
      {
        id: 1,
        type: 'risk',
        title: 'Capacity',
        description: 'Limited staffing',
        raised_by: 'Jane Doe',
        owner: 'Jane Doe',
        mitigation_actions: 'Hire help',
        impact: 4,
        likelihood: 4,
        score: 16,
        status: 'open',
        priority: 'High',
        target_date: '2026-01-10',
      },
    ],
    stakeholders: [
      { shortname: 'qa', name: 'Quinn QA', role: 'Reviewer', interest: 'high', influence: 'low' },
    ],
    comms_items: [
      { id: 1, activity: 'Standup', audience: 'Team', content: 'Status', frequency: 'Daily', channel: 'Teams', owner: 'Jane Doe', status: 'Active' },
    ],
    lessons_items: [
      { id: 1, project_manager: 'Jane Doe', project_type: 'IT', technology: 'JS', project_phase: 'Delivery', area: 'Schedule', impact_type: 'Needs to Change', observation: 'Obs', impact: 'Imp', recommendations: 'Rec', date: '2026-01-07' },
    ],
  };
}

const budgetItems = [
  {
    id: 1,
    description: 'Software',
    estimate: 80,
    forecast: 100,
    total: 20,
    type: 'Capex',
    invoice: 'INV-1',
    po: 'PO-1',
    supplier: 'Acme',
    date_ordered: '2026-01-01',
    date_received: '2026-01-02',
    category: 'Software',
  },
];

async function reloadWorkbook(workbook) {
  const bytes = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(bytes);
  return reloaded;
}

test('browser workbook includes all planned sheets in Python order', async () => {
  const workbook = await createPlanWorkbook(sampleParseResult(), {
    ExcelJS,
    budgetItems,
    now: new Date(2026, 0, 6, 9, 30),
  });
  const reloaded = await reloadWorkbook(workbook);
  assert.deepEqual(reloaded.worksheets.map((sheet) => sheet.name), [
    'Summary',
    'Tasks',
    'Milestones',
    'Resources',
    'Budget',
    'RAID Log',
    'Stakeholders',
    'EVM',
    'Comms Plan',
    'Lessons Learned',
    'Deliverables Matrix',
  ]);
});

test('tasks sheet preserves headers, dependencies, summary bolding, and exact Completed mapping', async () => {
  const workbook = await createPlanWorkbook(sampleParseResult(), { ExcelJS, budgetItems });
  const sheet = workbook.getWorksheet('Tasks');
  assert.deepEqual(sheet.getRow(1).values.slice(1), XL_TASK_HEADERS);
  assert.equal(sheet.getRow(2).getCell(2).font.bold, true);
  assert.equal(sheet.getRow(3).getCell(8).value, 'Completed');
  assert.equal(sheet.getRow(3).getCell(8).fill.fgColor.argb, 'FF808080');
  assert.equal(sheet.getRow(5).getCell(11).value, '2SS+1d');
  assert.equal(sheet.getRow(5).getCell(8).fill.fgColor.argb, 'FFFFC000');
});

test('milestones, budget, raid, stakeholders, comms, and lessons sheets use expected columns', async () => {
  const workbook = await createPlanWorkbook(sampleParseResult(), { ExcelJS, budgetItems, now: new Date(2026, 0, 6, 9, 30) });
  assert.deepEqual(workbook.getWorksheet('Milestones').getRow(1).values.slice(1), ['Milestone', 'Type', 'Date', 'Baseline Finish', 'Variance (days)']);
  assert.deepEqual(workbook.getWorksheet('Budget').getRow(1).values.slice(1), XL_BUDGET_HEADERS);
  assert.deepEqual(workbook.getWorksheet('RAID Log').getRow(1).values.slice(1), XL_RAID_HEADERS);
  assert.deepEqual(workbook.getWorksheet('Stakeholders').getRow(1).values.slice(1), XL_STAKEHOLDER_HEADERS);
  assert.deepEqual(workbook.getWorksheet('Comms Plan').getRow(1).values.slice(1), XL_COMMS_HEADERS);
  assert.deepEqual(workbook.getWorksheet('Lessons Learned').getRow(1).values.slice(1), XL_LESSONS_HEADERS);
  assert.equal(workbook.getWorksheet('Budget').getRow(3).getCell(2).value, 'TOTALS');
  assert.equal(workbook.getWorksheet('RAID Log').getRow(2).getCell(10).fill.fgColor.argb, 'FFFFE0E0');
  assert.equal(workbook.getWorksheet('Stakeholders').getRow(2).getCell(3).fill.fgColor.argb, 'FFFFE0E0');
});

test('resources, EVM, and deliverables sheets are built from browser-side data', async () => {
  const workbook = await createPlanWorkbook(sampleParseResult(), {
    ExcelJS,
    budgetItems,
    now: new Date(2026, 0, 6, 9, 30),
  });
  const resources = workbook.getWorksheet('Resources');
  assert.equal(resources.getRow(2).getCell(1).value, 'Jane Doe');
  assert.equal(resources.getRow(2).getCell(2).value, 10.7);
  assert.equal(resources.getRow(1).getCell(5).fill.fgColor.argb, 'FFD3D3D3');

  const evm = workbook.getWorksheet('EVM');
  assert.equal(evm.getRow(2).getCell(2).value, '90%');
  assert.equal(evm.getRow(7).getCell(2).fill.fgColor.argb, 'FFD3F9D8');
  assert.equal(evm.getRow(9).getCell(2).fill.fgColor.argb, 'FFD3F9D8');

  const deliverables = workbook.getWorksheet('Deliverables Matrix');
  assert.equal(deliverables.getRow(1).getCell(5).value, 'Approver');
  assert.equal(deliverables.getRow(1).getCell(6).value, 'Producer');
  assert.equal(deliverables.getRow(1).getCell(7).value, 'Reviewer');
  assert.equal(deliverables.getRow(2).getCell(8).value, '✓');
});

test('CSV export is built locally from the parse payload', () => {
  const csv = buildTaskCsv(sampleParseResult());
  assert.match(csv, /^ID,Task Name,Start,Finish,Duration \(days\),Resources,% Complete,RAG,Priority,Bucket,Comment/m);
  assert.match(csv, /Deliverable A,2026-01-01,2026-01-03,2,Jane Doe,100,Completed,High,Track A,/);
  assert.match(csv, /Go Live,2026-01-04,2026-01-06,1,Jane Doe,50,Behind Schedule,Low,Track B,/);
});

test('standalone RAID and benefits workbooks mirror their dedicated routes', async () => {
  const raidWorkbook = await createRaidWorkbook(sampleParseResult().raid_items, { ExcelJS });
  assert.equal(raidWorkbook.getWorksheet('RAID Log').getRow(1).cellCount, 11);

  const items = [
    { id: 1, type: 'benefit', title: 'Faster', targetValue: '10', currentValue: '3', targetDate: '2026-02-01', measurementMethod: 'KPI', status: 'Open', lastUpdated: '2026-01-01', linkedTo: [2], contributionPercent: 50, score: 8 },
    { id: 2, type: 'enabler', title: 'Tooling', linkedTo: [], contributionPercent: 0, score: 0 },
    { id: 3, type: 'disbenefit', title: 'Cost', targetValue: '5', currentValue: '1', targetDate: '2026-02-02', measurementMethod: 'KPI', status: 'Open', lastUpdated: '2026-01-02', linkedTo: [], contributionPercent: 25, score: 4 },
  ];
  const benefitsWorkbook = await createBenefitsWorkbook(items, { ExcelJS });
  const tracking = benefitsWorkbook.getWorksheet('Tracking');
  assert.deepEqual(benefitsWorkbook.worksheets.map((sheet) => sheet.name), ['Benefits Map', 'Tracking']);
  assert.equal(tracking.rowCount, 3);
  assert.equal(tracking.getRow(2).getCell(3).value, 'Faster');
  assert.equal(tracking.getRow(3).getCell(3).value, 'Cost');
});


test('standalone RAID and budget imports round-trip entirely in the browser', async () => {
  const raidWorkbook = await createRaidWorkbook([
    { id: 7, type: 'issue', title: 'Blocked', description: 'Waiting', raised_by: 'Jane', owner: 'Quinn', mitigation_actions: 'Escalate', impact: 6, likelihood: 0, score: 20, status: 'Transferred to issue' },
  ], { ExcelJS });
  const raidBytes = await raidWorkbook.xlsx.writeBuffer();
  const raidResult = await importRaidExcelInBrowser(raidBytes, { ExcelJS });
  assert.deepEqual(raidResult.items, [
    {
      id: 7,
      type: 'issue',
      title: 'Blocked',
      description: 'Waiting',
      raised_by: 'Jane',
      owner: 'Quinn',
      mitigation_actions: 'Escalate',
      impact: 5,
      likelihood: 3,
      score: 15,
      status: 'transferred',
    },
  ]);

  const budgetWorkbook = await createBudgetWorkbook([
    { id: 3, description: 'Laptop', estimate: 12.5, forecast: 15, type: 'Capex', invoice: 'I-3', po: 'P-3', supplier: 'Shop', total: 9.25, date_ordered: '2026-01-04', date_received: '2026-01-10', category: 'Hardware' },
  ], { ExcelJS });
  const budgetBytes = await budgetWorkbook.xlsx.writeBuffer();
  const budgetResult = await importBudgetExcelInBrowser(budgetBytes, { ExcelJS });
  assert.deepEqual(budgetResult.items, [
    {
      id: 3,
      description: 'Laptop',
      estimate: 12.5,
      forecast: 15,
      type: 'Capex',
      invoice: 'I-3',
      po: 'P-3',
      supplier: 'Shop',
      total: 9.25,
      date_ordered: '2026-01-04',
      date_received: '2026-01-10',
      category: 'Hardware',
    },
  ]);
});

test('deliverables role resolution reverses full resource names back to shortnames', () => {
  const data = buildDeliverablesData(sampleParseResult().tasks, sampleParseResult().resource_map, sampleParseResult().resource_roles, sampleParseResult().stakeholders);
  assert.deepEqual(data.people, ['ap', 'jd', 'qa']);
  assert.equal(data.role_map.jd, 'Producer');
  assert.equal(data.items[0].roles.jd, 'P');
});

test('Python-style EVM calculation is stable and independent of the UI globals', () => {
  const evm = calculateWorkbookEvm(sampleParseResult().tasks, budgetItems, new Date(2026, 0, 6, 12, 0));
  assert.deepEqual(
    {
      bac: evm.BAC,
      pv: evm.PV,
      ev: evm.EV,
      ac: evm.AC,
      cpi: evm.CPI,
      spi: evm.SPI,
    },
    {
      bac: 100,
      pv: 100,
      ev: 90,
      ac: 20,
      cpi: 4.5,
      spi: 0.9,
    },
  );
});

test('the page and scripts are pinned and wired for browser Excel export', () => {
  const index = readFileSync(join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates', 'index.html'), 'utf8');
  const scriptJs = readFileSync(join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'script.js'), 'utf8');
  const benefitsJs = readFileSync(join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'benefits.js'), 'utf8');
  const packageJson = readFileSync(join(repo, 'package.json'), 'utf8');

  assert.ok(index.includes(EXCELJS_CDN_URL));
  assert.ok(scriptJs.includes("browserExcelExportsEnabled()"));
  assert.ok(scriptJs.includes("import('/static/browser-excel.js')"));
  assert.ok(scriptJs.includes('importRaidExcelInBrowser'));
  assert.ok(scriptJs.includes('importBudgetExcelInBrowser'));
  assert.ok(benefitsJs.includes("import('/static/browser-excel.js')"));
  assert.ok(packageJson.includes('"exceljs": "4.4.0"'));
  assert.ok(packageJson.includes('"uuid": "11.1.1"'));
});

test('RAG mapping keeps the closed lookup semantics', () => {
  assert.equal(xlRagColour('Completed'), 'grey');
  assert.equal(xlRagColour('Complete'), 'blue');
  assert.equal(xlRagColour('Behind Schedule'), 'amber');
  assert.equal(xlRagColour('Task Overdue'), 'red');
});
