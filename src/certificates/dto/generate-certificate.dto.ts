import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CertificateTemplate } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * `POST /certificates/generate` — `frontend/src/features/certificates/schemas.ts`'s
 * `generateCertificateSchema`. `studentLabel` is accepted (the frontend always sends it, resolved
 * client-side from its own student search) but never trusted for the rendered document —
 * `CertificatesService.generate` re-resolves the real name from the `Student` row itself, the same
 * never-trust-a-client-supplied-display-value discipline every other server-computed field in this
 * schema follows. `fields`' required keys (per template, `custom` excepted) and `customTitle`'s
 * requirement for the `custom` template are validated in the service, not here — the same
 * conditional-shape-depends-on-another-field pattern `AdmissionsService`'s stage-transition checks
 * already use, since `class-validator`'s conditional decorators don't compose cleanly with a
 * free-form `fields` object.
 */
export class GenerateCertificateDto {
  @ApiProperty({ enum: CertificateTemplate })
  @IsEnum(CertificateTemplate)
  template!: CertificateTemplate;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customTitle?: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  fields!: Record<string, string>;
}
