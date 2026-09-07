import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateDocumentOwnerDto } from './dto/update-document-owner.dto';
import {
  DocumentResponseDto,
  DocumentVersionResponseDto,
  PagedDocumentsDto,
} from './dto/document-response.dto';
import { MAX_UPLOAD_SIZE_BYTES } from './upload-validation';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @RequirePermission('documents.read')
  list(@Query() query: ListDocumentsQueryDto): Promise<PagedDocumentsDto> {
    return this.documentsService.list(query);
  }

  @Get(':id')
  @RequirePermission('documents.read')
  get(@Param('id') id: string): Promise<DocumentResponseDto> {
    return this.documentsService.get(id);
  }

  @Get(':id/versions')
  @RequirePermission('documents.read')
  listVersions(@Param('id') id: string): Promise<DocumentVersionResponseDto[]> {
    return this.documentsService.listVersions(id);
  }

  @Post('upload')
  @RequirePermission('documents.upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentsService.upload(dto, file, user);
  }

  @Patch(':id')
  @RequirePermission('documents.upload')
  updateOwner(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentOwnerDto,
  ): Promise<DocumentResponseDto> {
    return this.documentsService.updateOwner(id, dto);
  }

  @Delete(':id')
  @RequirePermission('documents.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.documentsService.remove(id);
  }
}
