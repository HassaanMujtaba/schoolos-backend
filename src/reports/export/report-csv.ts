import {
  ReportExportModel,
  sanitizeSpreadsheetCell,
} from './report-export-model';

/**
 * `GET /reports/:id/export?format=csv` — flattens `ReportExportModel` into one CSV: a "Summary"
 * section (label/value pairs) followed by one blank line and each table, its own header row
 * first. `csvEscape` is intentionally duplicated here rather than imported from
 * `students.service.ts`/`attendance.service.ts` — same small-per-module-helper convention those
 * two already independently repeat.
 */
export function renderReportCsv(model: ReportExportModel): string {
  const lines: string[] = [];
  lines.push([csvEscape(model.title), csvEscape(model.subtitle)].join(','));
  lines.push('');

  if (model.summary.length > 0) {
    lines.push('Summary');
    for (const { label, value } of model.summary) {
      lines.push([csvEscape(label), csvEscape(value)].join(','));
    }
    lines.push('');
  }

  for (const table of model.tables) {
    lines.push(csvEscape(table.title));
    lines.push(table.columns.map(csvEscape).join(','));
    for (const row of table.rows) {
      lines.push(
        row
          .map((cell) => csvEscape(sanitizeSpreadsheetCell(String(cell))))
          .join(','),
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
