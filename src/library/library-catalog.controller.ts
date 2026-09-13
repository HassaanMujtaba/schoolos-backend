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
import { LibraryCatalogService } from './library-catalog.service';
import { ReferenceEntryDto } from './dto/reference-entry.dto';
import { BookDto, ListBooksQueryDto } from './dto/book.dto';
import { CopyDto } from './dto/copy.dto';
import {
  BookResponseDto,
  CopyResponseDto,
  PagedBooksDto,
  ReferenceEntryResponseDto,
} from './dto/library-response.dto';

/** `frontend/src/features/library/api.ts`'s catalog surface — categories, shelves, books, copies. */
@ApiTags('library')
@Controller('library')
export class LibraryCatalogController {
  constructor(private readonly catalog: LibraryCatalogService) {}

  @Get('categories')
  @RequirePermission('library.read')
  listCategories(): Promise<ReferenceEntryResponseDto[]> {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @RequirePermission('library.manage-catalog')
  createCategory(
    @Body() dto: ReferenceEntryDto,
  ): Promise<ReferenceEntryResponseDto> {
    return this.catalog.createCategory(dto);
  }

  @Delete('categories/:id')
  @RequirePermission('library.manage-catalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param('id') id: string): Promise<void> {
    return this.catalog.deleteCategory(id);
  }

  @Get('shelves')
  @RequirePermission('library.read')
  listShelves(): Promise<ReferenceEntryResponseDto[]> {
    return this.catalog.listShelves();
  }

  @Post('shelves')
  @RequirePermission('library.manage-catalog')
  createShelf(
    @Body() dto: ReferenceEntryDto,
  ): Promise<ReferenceEntryResponseDto> {
    return this.catalog.createShelf(dto);
  }

  @Delete('shelves/:id')
  @RequirePermission('library.manage-catalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteShelf(@Param('id') id: string): Promise<void> {
    return this.catalog.deleteShelf(id);
  }

  @Get('books')
  @RequirePermission('library.read')
  listBooks(@Query() query: ListBooksQueryDto): Promise<PagedBooksDto> {
    return this.catalog.listBooks(query);
  }

  @Get('books/:id')
  @RequirePermission('library.read')
  getBook(@Param('id') id: string): Promise<BookResponseDto> {
    return this.catalog.getBook(id);
  }

  @Post('books')
  @RequirePermission('library.manage-catalog')
  createBook(@Body() dto: BookDto): Promise<BookResponseDto> {
    return this.catalog.createBook(dto);
  }

  @Patch('books/:id')
  @RequirePermission('library.manage-catalog')
  updateBook(
    @Param('id') id: string,
    @Body() dto: BookDto,
  ): Promise<BookResponseDto> {
    return this.catalog.updateBook(id, dto);
  }

  @Delete('books/:id')
  @RequirePermission('library.manage-catalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBook(@Param('id') id: string): Promise<void> {
    return this.catalog.removeBook(id);
  }

  @Get('books/:bookId/copies')
  @RequirePermission('library.read')
  listCopies(@Param('bookId') bookId: string): Promise<CopyResponseDto[]> {
    return this.catalog.listCopies(bookId);
  }

  @Post('books/:bookId/copies')
  @RequirePermission('library.manage-catalog')
  createCopy(
    @Param('bookId') bookId: string,
    @Body() dto: CopyDto,
  ): Promise<CopyResponseDto> {
    return this.catalog.createCopy(bookId, dto);
  }

  @Delete('books/:bookId/copies/:copyId')
  @RequirePermission('library.manage-catalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCopy(
    @Param('bookId') bookId: string,
    @Param('copyId') copyId: string,
  ): Promise<void> {
    return this.catalog.removeCopy(bookId, copyId);
  }
}
