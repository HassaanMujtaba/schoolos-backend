import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

/**
 * §32 "Generate → PDF with QR code + unique certificate number" — the one piece of this module
 * that isn't a thin CRUD wrapper. Deliberately simple, letterhead-style layout (school name as the
 * header, no embedded logo image) rather than a full templating engine — `School.logoUrl` is an
 * arbitrary stored URL, and fetching it server-side on every generate call for a purely cosmetic
 * image would be new outbound-request surface (`security-standards`' SSRF guidance) for something
 * nobody asked for; text branding covers §32's actual requirement ("School branding applied
 * automatically ... from the school profile"). Swap in a real logo/letterhead image once school
 * profile uploads go through the `documents/` primitive instead of a free-text URL.
 *
 * A pure function (no Prisma/Nest DI) so it's unit-testable without a database — mirrors
 * `examinations/grading-scale.ts`'s "business logic that happens to render, not fetch" shape.
 */
export interface CertificatePdfInput {
  schoolName: string;
  title: string;
  studentName: string;
  admissionNumber: string;
  className: string;
  sectionName: string;
  templateLabel: string;
  certificateNumber: string;
  issuedAt: Date;
  /** `{ label, value }` pairs — the template's dynamic fields, already label-resolved. */
  fields: { label: string; value: string }[];
  /** The full public verify URL this certificate's QR code encodes. */
  verifyUrl: string;
}

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

export async function renderCertificatePdf(
  input: CertificatePdfInput,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const qrPng = await QRCode.toBuffer(input.verifyUrl, {
    type: 'png',
    margin: 1,
    width: 240,
  });
  const qrImage = await doc.embedPng(qrPng);

  let y = PAGE_HEIGHT - MARGIN;

  // Letterhead.
  page.drawText(input.schoolName, {
    x: MARGIN,
    y,
    size: 20,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 28;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.75, 0.75, 0.75),
  });
  y -= 48;

  // Title.
  page.drawText(input.title, {
    x: MARGIN,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 40;

  const bodyLines = [
    `This is to certify that ${input.studentName} (Admission No. ${input.admissionNumber}),`,
    `a student of Class ${input.className}${input.sectionName ? `-${input.sectionName}` : ''} at ${input.schoolName},`,
    ...input.fields.map((f) => `${f.label}: ${f.value}`),
  ];
  for (const line of bodyLines) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 11,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 20;
  }

  y -= 24;
  page.drawText(`Certificate No.: ${input.certificateNumber}`, {
    x: MARGIN,
    y,
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 16;
  page.drawText(`Issued: ${input.issuedAt.toISOString().slice(0, 10)}`, {
    x: MARGIN,
    y,
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  // QR code, bottom-right — scan to verify authenticity without logging in.
  const qrSize = 100;
  page.drawImage(qrImage, {
    x: PAGE_WIDTH - MARGIN - qrSize,
    y: MARGIN,
    width: qrSize,
    height: qrSize,
  });
  page.drawText('Scan to verify', {
    x: PAGE_WIDTH - MARGIN - qrSize,
    y: MARGIN - 14,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
