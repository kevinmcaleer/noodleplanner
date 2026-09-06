import { readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

import { createPlanWorkbook } from '../../packages/noodle-web/src/noodle_web/static/browser-excel.js';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('usage: build_browser_excel.mjs INPUT_JSON OUTPUT_XLSX');
}

const payload = JSON.parse(await readFile(inputPath, 'utf8'));
const workbook = await createPlanWorkbook(payload.parseResult, {
  ExcelJS,
  budgetItems: payload.budgetItems,
  projectName: payload.projectName,
});
await writeFile(outputPath, await workbook.xlsx.writeBuffer());
