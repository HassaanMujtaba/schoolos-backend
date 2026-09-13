import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { LibraryCirculationService } from './library-circulation.service';
import {
  IssueBookDto,
  ListFinesQueryDto,
  LookupCopyQueryDto,
  ReturnBookDto,
} from './dto/circulation.dto';
import { ListLoansQueryDto } from './dto/list-loans-query.dto';
import {
  CirculationLookupResponseDto,
  LoanResponseDto,
  PagedLoansDto,
} from './dto/library-response.dto';

/** `frontend/src/features/library/api.ts`'s circulation + portal-loans surface. */
@ApiTags('library')
@Controller('library')
export class LibraryCirculationController {
  constructor(private readonly circulation: LibraryCirculationService) {}

  @Get('copies/lookup')
  @RequirePermission('library.circulate')
  lookupCopy(
    @Query() query: LookupCopyQueryDto,
  ): Promise<CirculationLookupResponseDto> {
    return this.circulation.lookupByBarcode(query);
  }

  @Post('issue')
  @RequirePermission('library.circulate')
  issue(@Body() dto: IssueBookDto): Promise<LoanResponseDto> {
    return this.circulation.issueBook(dto);
  }

  @Post('return')
  @RequirePermission('library.circulate')
  returnBook(@Body() dto: ReturnBookDto): Promise<LoanResponseDto> {
    return this.circulation.returnBook(dto);
  }

  @Get('fines')
  @RequirePermission('library.circulate')
  listFines(@Query() query: ListFinesQueryDto): Promise<PagedLoansDto> {
    return this.circulation.listFines(query);
  }

  @Post('fines/:loanId/pay')
  @RequirePermission('library.circulate')
  @HttpCode(HttpStatus.OK)
  payFine(@Param('loanId') loanId: string): Promise<LoanResponseDto> {
    return this.circulation.payFine(loanId);
  }

  @Post('fines/:loanId/waive')
  @RequirePermission('library.circulate')
  @HttpCode(HttpStatus.OK)
  waiveFine(@Param('loanId') loanId: string): Promise<LoanResponseDto> {
    return this.circulation.waiveFine(loanId);
  }

  // Portal — `modules/library.md` "view own borrowed books". No `@RequirePermission`, same
  // `studentId=me` idiom as `attendance`/`homework`'s own portal reads.
  @Get('loans')
  listLoansForStudent(
    @Query() query: ListLoansQueryDto,
  ): Promise<LoanResponseDto[]> {
    return this.circulation.listLoansForStudent(query.studentId);
  }
}
