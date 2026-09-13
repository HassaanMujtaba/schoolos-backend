import ExcelJS from 'exceljs';
import {
  ReportExportModel,
  sanitizeSpreadsheetCell,
} from '../export/report-export-model';

/**
 * `GET /reports/:id/export?format=excel` — one workbook, a "Summary" sheet (label/value pairs)
 * plus one sheet per table (Excel sheet names cap at 31 chars and can't hold `/\?*[]:`, so
 * `sheetName` below sanitizes and truncates rather than trusting the table title verbatim).
 */
export async function renderReportExcel(
  model: ReportExportModel,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SchoolOS';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.addRow([model.title]).font = { bold: true, size: 14 };
  summarySheet.addRow([model.subtitle]);
  summarySheet.addRow([]);
  const summaryHeader = summarySheet.addRow(['Metric', 'Value']);
  summaryHeader.font = { bold: true };
  for (const { label, value } of model.summary) {
    summarySheet.addRow([label, value]);
  }
  summarySheet.getColumn(1).width = 28;
  summarySheet.getColumn(2).width = 20;

  const usedSheetNames = new Set<string>(['Summary']);
  for (const table of model.tables) {
    const sheet = workbook.addWorksheet(sheetName(table.title, usedSheetNames));
    const headerRow = sheet.addRow(table.columns);
    headerRow.font = { bold: true };
    for (const row of table.rows) {
      sheet.addRow(
        row.map((cell) =>
          typeof cell === 'string' ? sanitizeSpreadsheetCell(cell) : cell,
        ),
      );
    }
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function sheetName(title: string, used: Set<string>): string {
  const base =
    title
      .replace(/[/\\?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 28)} ${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}
