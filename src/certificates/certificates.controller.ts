import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { CertificatesService } from './certificates.service';
import { GenerateCertificateDto } from './dto/generate-certificate.dto';
import { ListCertificatesQueryDto } from './dto/list-certificates-query.dto';
import {
  CertificateResponseDto,
  CertificateVerificationResponseDto,
  PagedCertificatesDto,
} from './dto/certificate-response.dto';

@ApiTags('certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @RequirePermission('certificates.read')
  list(
    @Query() query: ListCertificatesQueryDto,
  ): Promise<PagedCertificatesDto> {
    return this.certificates.list(query);
  }

  @Post('generate')
  @RequirePermission('certificates.generate')
  generate(
    @Body() dto: GenerateCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CertificateResponseDto> {
    return this.certificates.generate(dto, user);
  }

  // Mounted under the same `/certificates` prefix as the rest of this controller, but genuinely
  // public — someone scanning a certificate's QR code shouldn't need to log in
  // (`modules/documents-certificates.md`'s own call-out). No `GET /certificates/:id` exists in
  // this controller to collide with `verify/:code` (`certificates/api.ts` has no single-get call),
  // so there's no route-ordering concern here — kept last in this file anyway, to read as "the one
  // exception," matching `AuthController`'s own ordering of its `@Public()` routes.
  @Get('verify/:code')
  @Public()
  verify(
    @Param('code') code: string,
  ): Promise<CertificateVerificationResponseDto> {
    return this.certificates.verify(code);
  }
}
