import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ReportsService } from './reports.service';
import { AcademicReportQueryDto } from './dto/academic-report-query.dto';
import { FinancialReportQueryDto } from './dto/financial-report-query.dto';
import {
  ExportReportQueryDto,
  REPORT_KINDS,
  ReportKind,
} from './dto/export-report-query.dto';
import {
  AcademicReportResponseDto,
  FinancialReportResponseDto,
  PrincipalDashboardResponseDto,
} from './dto/report-response.dto';

/**
 * `frontend/src/features/reports/api.ts`'s surface — one `reports.read` gate for the whole
 * `/dashboard/reports` subtree (module doc "Roles & permissions": "no separate read permission
 * per sub-report"), `reports.export` on the one export route every panel's `ExportButton` shares.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('principal-dashboard')
  @RequirePermission('reports.read')
  getPrincipalDashboard(): Promise<PrincipalDashboardResponseDto> {
    return this.reports.getPrincipalDashboard();
  }

  @Get('academic')
  @RequirePermission('reports.read')
  getAcademicReport(
    @Query() query: AcademicReportQueryDto,
  ): Promise<AcademicReportResponseDto> {
    return this.reports.getAcademicReport(query);
  }

  @Get('financial')
  @RequirePermission('reports.read')
  getFinancialReport(
    @Query() query: FinancialReportQueryDto,
  ): Promise<FinancialReportResponseDto> {
    return this.reports.getFinancialReport(query);
  }

  // Declared last, same route-ordering discipline `students.controller.ts`'s own `export` route
  // comment documents — `GET :id/export` couldn't actually shadow the three fixed routes above
  // even declared first (`/export` is a path *suffix*, not the whole route), but ordering it last
  // reads as "the one exception" rather than relying on that distinction.
  @Get(':id/export')
  @RequirePermission('reports.export')
  @Header('Cache-Control', 'no-store')
  async export(
    @Param('id') id: string,
    @Query() query: ExportReportQueryDto,
  ): Promise<StreamableFile> {
    if (!REPORT_KINDS.includes(id as ReportKind)) {
      throw new BadRequestException(`Unknown report id: ${id}`);
    }
    const { buffer, contentType, filename } = await this.reports.exportReport(
      id as ReportKind,
      query.format,
      query,
    );
    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
