import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AdmissionStage } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { RequireAnyPermission } from '../common/decorators/require-any-permission.decorator';
import { AdmissionsService } from './admissions.service';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { UpdateAdmissionDto } from './dto/update-admission.dto';
import { ScoreApplicationDto } from './dto/score-application.dto';
import { DecideAdmissionDto } from './dto/decide-admission.dto';
import { SubmitDocumentsDto } from './dto/submit-documents.dto';
import { ListAdmissionsQueryDto } from './dto/list-admissions-query.dto';
import {
  AdmissionResponseDto,
  PagedAdmissionsDto,
} from './dto/admission-response.dto';

@ApiTags('admissions')
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  // Declared before `:id` — same reasoning as `StudentsController.export`.
  @Get('funnel')
  @RequirePermission('admissions.read')
  funnel(): Promise<Record<AdmissionStage, number>> {
    return this.admissionsService.funnel();
  }

  @Get()
  @RequirePermission('admissions.read')
  list(@Query() query: ListAdmissionsQueryDto): Promise<PagedAdmissionsDto> {
    return this.admissionsService.list(query);
  }

  @Get(':id')
  @RequirePermission('admissions.read')
  get(@Param('id') id: string): Promise<AdmissionResponseDto> {
    return this.admissionsService.get(id);
  }

  @Post()
  @RequirePermission('admissions.create')
  createInquiry(@Body() dto: CreateInquiryDto): Promise<AdmissionResponseDto> {
    return this.admissionsService.createInquiry(dto);
  }

  @Patch(':id')
  @RequirePermission('admissions.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdmissionDto,
  ): Promise<AdmissionResponseDto> {
    return this.admissionsService.update(id, dto);
  }

  @Patch(':id/documents')
  @RequirePermission('admissions.update')
  submitDocuments(
    @Param('id') id: string,
    @Body() dto: SubmitDocumentsDto,
  ): Promise<AdmissionResponseDto> {
    return this.admissionsService.submitDocuments(id, dto);
  }

  @Post(':id/score')
  @RequirePermission('admissions.update')
  @HttpCode(HttpStatus.OK) // updates the existing application, doesn't create a new resource
  scoreApplication(
    @Param('id') id: string,
    @Body() dto: ScoreApplicationDto,
  ): Promise<AdmissionResponseDto> {
    return this.admissionsService.scoreApplication(id, dto);
  }

  @Patch(':id/decision')
  @RequireAnyPermission('admissions.approve', 'admissions.reject')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideAdmissionDto,
  ): Promise<AdmissionResponseDto> {
    return this.admissionsService.decide(id, dto);
  }

  @Post(':id/enroll')
  @RequirePermission('admissions.update')
  @HttpCode(HttpStatus.OK)
  enroll(@Param('id') id: string): Promise<{ studentId: string }> {
    return this.admissionsService.enroll(id);
  }
}
