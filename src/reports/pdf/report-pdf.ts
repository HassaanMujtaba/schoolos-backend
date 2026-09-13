import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { ReportExportModel } from '../export/report-export-model';

/**
 * `GET /reports/:id/export?format=pdf` — a plain letterhead-style layout (school name + title +
 * summary metrics + one table per section), same simple-not-templated trade-off
 * `certificates/pdf/certificate-pdf.ts` already makes for the same "nobody asked for a real
 * templating engine" reason. Unlike that single-page certificate, a report table can run past one
 * page (e.g. every class in a large school), so this is the first PDF in this codebase that
 * actually paginates — `Cursor` below is the whole mechanism: draw, and start a fresh page
 * whenever the next line would cross the bottom margin.
 */
export interface ReportPdfInput {
  schoolName: string;
  model: ReportExportModel;
  generatedAt: Date;
}

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const LINE_HEIGHT = 16;

interface Cursor {
  doc: PDFDocument;
  font: PDFFont;
  boldFont: PDFFont;
  page: PDFPage;
  y: number;
}

function newPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

function ensureSpace(cursor: Cursor, needed: number): void {
  if (cursor.y - needed < MARGIN) {
    cursor.page = newPage(cursor.doc);
    cursor.y = PAGE_HEIGHT - MARGIN;
  }
}

function drawLine(
  cursor: Cursor,
  text: string,
  options: {
    size?: number;
    bold?: boolean;
    color?: [number, number, number];
    gap?: number;
  } = {},
): void {
  const size = options.size ?? 11;
  const gap = options.gap ?? LINE_HEIGHT;
  ensureSpace(cursor, gap);
  const [r, g, b] = options.color ?? [0.15, 0.15, 0.15];
  cursor.page.drawText(text, {
    x: MARGIN,
    y: cursor.y,
    size,
    font: options.bold ? cursor.boldFont : cursor.font,
    color: rgb(r, g, b),
  });
  cursor.y -= gap;
}

function drawTable(
  cursor: Cursor,
  columns: string[],
  rows: Array<Array<string | number>>,
): void {
  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const columnWidth = usableWidth / columns.length;

  const drawRow = (values: Array<string | number>, bold: boolean): void => {
    ensureSpace(cursor, LINE_HEIGHT);
    values.forEach((value, index) => {
      cursor.page.drawText(String(value), {
        x: MARGIN + index * columnWidth,
        y: cursor.y,
        size: 10,
        font: bold ? cursor.boldFont : cursor.font,
        color: rgb(0.15, 0.15, 0.15),
        maxWidth: columnWidth - 6,
      });
    });
    cursor.y -= LINE_HEIGHT;
  };

  drawRow(columns, true);
  cursor.y -= 2;
  if (rows.length === 0) {
    drawLine(cursor, 'No data for this selection.', {
      size: 9,
      color: [0.5, 0.5, 0.5],
      gap: LINE_HEIGHT,
    });
    return;
  }
  for (const row of rows) {
    drawRow(row, false);
  }
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const cursor: Cursor = {
    doc,
    font,
    boldFont,
    page: newPage(doc),
    y: PAGE_HEIGHT - MARGIN,
  };

  drawLine(cursor, input.schoolName, { size: 16, bold: true, gap: 22 });
  drawLine(cursor, input.model.title, { size: 20, bold: true, gap: 28 });
  drawLine(cursor, input.model.subtitle, {
    size: 10,
    color: [0.4, 0.4, 0.4],
    gap: 20,
  });
  drawLine(
    cursor,
    `Generated ${input.generatedAt.toISOString().slice(0, 10)}`,
    {
      size: 9,
      color: [0.5, 0.5, 0.5],
      gap: 24,
    },
  );

  if (input.model.summary.length > 0) {
    for (const { label, value } of input.model.summary) {
      drawLine(cursor, `${label}: ${value}`, { size: 11 });
    }
    cursor.y -= 12;
  }

  for (const table of input.model.tables) {
    drawLine(cursor, table.title, { size: 13, bold: true, gap: 20 });
    drawTable(cursor, table.columns, table.rows);
    cursor.y -= 16;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
