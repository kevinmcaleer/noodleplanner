import { readFile } from 'node:fs/promises';

import {
  importBudgetExcelInBrowser,
  importRaidExcelInBrowser,
} from '../../packages/noodle-web/src/noodle_web/static/browser-excel.js';

const [kind, inputPath] = process.argv.slice(2);
if (!['budget', 'raid'].includes(kind) || !inputPath) {
  throw new Error('usage: import_browser_excel.mjs budget|raid INPUT_XLSX');
}

const bytes = await readFile(inputPath);
const result = kind === 'budget'
  ? await importBudgetExcelInBrowser(bytes)
  : await importRaidExcelInBrowser(bytes);
process.stdout.write(JSON.stringify(result));
