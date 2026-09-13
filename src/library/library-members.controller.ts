import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { LibraryMembersService } from './library-members.service';
import {
  ListMembersQueryDto,
  MemberDto,
  UpdateMemberStatusDto,
} from './dto/member.dto';
import { MemberResponseDto, PagedMembersDto } from './dto/library-response.dto';

/** `frontend/src/features/library/api.ts`'s members surface. */
@ApiTags('library')
@Controller('library/members')
export class LibraryMembersController {
  constructor(private readonly members: LibraryMembersService) {}

  @Get()
  @RequirePermission('library.read')
  list(@Query() query: ListMembersQueryDto): Promise<PagedMembersDto> {
    return this.members.list(query);
  }

  @Post()
  @RequirePermission('library.manage-catalog')
  create(@Body() dto: MemberDto): Promise<MemberResponseDto> {
    return this.members.create(dto);
  }

  @Patch(':id')
  @RequirePermission('library.manage-catalog')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateMemberStatusDto,
  ): Promise<MemberResponseDto> {
    return this.members.updateStatus(id, dto);
  }

  @Delete(':id')
  @RequirePermission('library.manage-catalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.members.remove(id);
  }
}
