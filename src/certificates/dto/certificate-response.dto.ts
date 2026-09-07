import { ApiProperty } from '@nestjs/swagger';
import { CertificateTemplate } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/certificates/api.ts`'s `Certificate`. */
export class CertificateResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() certificateNumber!: string;
  @ApiProperty({ enum: CertificateTemplate }) template!: CertificateTemplate;
  @ApiProperty() title!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty() studentLabel!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  fields!: Record<string, string>;
  @ApiProperty() generatedAt!: string;
  @ApiProperty() generatedByLabel!: string;
  /** Presigned, time-limited — never a stable/public URL, same discipline as `documents/`'s `url`. */
  @ApiProperty() pdfUrl!: string;
  /** Encoded in the certificate's QR; also `/certificates/verify/:code`'s param. */
  @ApiProperty() verifyCode!: string;
}

export class PagedCertificatesDto implements PagedResult<CertificateResponseDto> {
  @ApiProperty({ type: [CertificateResponseDto] })
  items!: CertificateResponseDto[];
  @ApiProperty() total!: number;
}

/** `GET /certificates/verify/:code` — `certificates/api.ts`'s `CertificateVerification`. */
export class CertificateVerificationResponseDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty() certificateNumber!: string;
  @ApiProperty({ enum: CertificateTemplate }) template!: CertificateTemplate;
  @ApiProperty() studentLabel!: string;
  @ApiProperty() schoolName!: string;
  @ApiProperty() generatedAt!: string;
}
