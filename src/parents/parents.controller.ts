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
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { ParentsService } from './parents.service';
import { ParentDto } from './dto/parent.dto';
import { LinkChildDto } from './dto/link-child.dto';
import {
  ChildDto,
  PagedParentsDto,
  ParentResponseDto,
} from './dto/parent-response.dto';

@ApiTags('parents')
@Controller('parents')
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  // Declared before `:id` — same reasoning as `StudentsController.export`.
  @Get('me/children')
  getMyChildren(@CurrentUser() user: AuthenticatedUser): Promise<ChildDto[]> {
    return this.parentsService.getMyChildren(user.id);
  }

  @Get()
  @RequirePermission('parents.read')
  list(@Query() query: ListQueryDto): Promise<PagedParentsDto> {
    return this.parentsService.list(query);
  }

  @Get(':id')
  @RequirePermission('parents.read')
  get(@Param('id') id: string): Promise<ParentResponseDto> {
    return this.parentsService.get(id);
  }

  @Post()
  @RequirePermission('parents.create')
  create(@Body() dto: ParentDto): Promise<ParentResponseDto> {
    return this.parentsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('parents.update')
  update(
    @Param('id') id: string,
    @Body() dto: ParentDto,
  ): Promise<ParentResponseDto> {
    return this.parentsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('parents.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.parentsService.remove(id);
  }

  @Post(':id/children')
  @RequirePermission('parents.update')
  linkChild(
    @Param('id') id: string,
    @Body() dto: LinkChildDto,
  ): Promise<ChildDto> {
    return this.parentsService.linkChild(id, dto);
  }

  @Delete(':id/children/:studentId')
  @RequirePermission('parents.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkChild(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ): Promise<void> {
    return this.parentsService.unlinkChild(id, studentId);
  }
}
