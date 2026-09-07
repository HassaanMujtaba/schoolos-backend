import { CertificateTemplate } from '@prisma/client';

/**
 * Mirrors `frontend/src/features/certificates/schemas.ts`'s `CERTIFICATE_TEMPLATE_LABELS`/
 * `CERTIFICATE_TEMPLATE_FIELDS` — same "server mirrors the frontend's own map" convention
 * `examinations/grading-scale.ts`'s `EXAM_TYPE_LABELS` mirror already established. Dynamic fields
 * per template are an assumed, frontend-fixed set (`modules/documents-certificates.md`'s own "Open
 * questions": no template-config endpoint is documented) — a real, honestly-flagged placeholder
 * like `grading-scale.ts`'s fixed percentage→grade scale, not a per-tenant setting invented to
 * look configurable. Swap for a real per-tenant/template-config lookup once that's scoped; nothing
 * downstream (the `fields` JSON column, the response shape) needs to change when it does.
 */
export const CERTIFICATE_TEMPLATE_LABELS: Record<CertificateTemplate, string> =
  {
    bonafide: 'Bonafide certificate',
    enrollment: 'Enrollment certificate',
    character: 'Character certificate',
    transfer: 'Transfer certificate',
    leaving: 'Leaving certificate',
    achievement: 'Achievement certificate',
    custom: 'Custom certificate',
  };

export interface CertificateTemplateField {
  key: string;
  label: string;
}

/** No entry for `custom` — it has no fixed fields, matching the frontend's own map exactly. */
export const CERTIFICATE_TEMPLATE_FIELDS: Partial<
  Record<CertificateTemplate, CertificateTemplateField[]>
> = {
  bonafide: [{ key: 'purpose', label: 'Purpose' }],
  enrollment: [{ key: 'academicYear', label: 'Academic year' }],
  character: [{ key: 'remarks', label: 'Conduct remarks' }],
  transfer: [
    { key: 'reasonForLeaving', label: 'Reason for leaving' },
    { key: 'lastAttendanceDate', label: 'Last attendance date' },
  ],
  leaving: [
    { key: 'reasonForLeaving', label: 'Reason for leaving' },
    { key: 'lastAttendanceDate', label: 'Last attendance date' },
  ],
  achievement: [
    { key: 'achievementTitle', label: 'Achievement title' },
    { key: 'eventDate', label: 'Event date' },
  ],
};
