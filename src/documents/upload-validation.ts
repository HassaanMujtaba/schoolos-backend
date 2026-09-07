import { BadRequestException } from '@nestjs/common';

/**
 * Server-side file-type/size enforcement (`SECURITY.md`: "the frontend must not be the only check
 * on file type/size" — `components/ui/file-upload-field.tsx`'s `accept`/`maxSizeMb` are a UX
 * nicety only). Covers the categories `documents-certificates.md`'s own consumers actually pick
 * from (`DocumentsPanel`'s `accept=".pdf,.jpg,.jpeg,.png"`, `StudentForm`'s photo field) plus the
 * common office-document formats §31 lists — extend this allowlist deliberately, never widen it to
 * "anything" for convenience.
 */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Matches `FileUploadField`'s own default `maxSizeMb = 10`.
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * The EICAR test string — an industry-standard, intentionally-harmless byte sequence every real
 * antivirus engine (including S3/ClamAV-based scanners) is built to detect, used to prove a
 * scanning integration actually runs rather than being a no-op. Checking for it directly is
 * **not** a substitute for real virus/malware scanning (§31 "Use") — it's a stub that makes this
 * gap testable and honest rather than silently pretending scanning happens. Replace with a real
 * ClamAV/S3-native-scanning call before this endpoint handles real user uploads in production; see
 * `../../implementation-plan.md`'s Phase 3 status note for this exact caveat.
 */
const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export function assertUploadIsSafe(file: {
  mimetype: string;
  size: number;
  buffer: Buffer;
}): void {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new BadRequestException(
      `File exceeds the ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB limit`,
    );
  }
  if (file.buffer.includes(EICAR_SIGNATURE)) {
    throw new BadRequestException('File rejected by malware scan');
  }
}
