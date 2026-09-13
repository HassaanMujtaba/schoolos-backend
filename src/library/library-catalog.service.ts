import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Book, BookCopy, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { ReferenceEntryDto } from './dto/reference-entry.dto';
import { BookDto, ListBooksQueryDto } from './dto/book.dto';
import { CopyDto } from './dto/copy.dto';
import {
  BookResponseDto,
  CopyResponseDto,
  ReferenceEntryResponseDto,
} from './dto/library-response.dto';

type BookWithCopies = Book & { copies: BookCopy[] };

/**
 * `frontend/src/features/library/api.ts`'s catalog surface (`modules/library.md` "Catalog:
 * books ... categories, shelves"). Categories/shelves are lightweight, add/delete-only reference
 * lists — no update endpoint, matching `api.ts` exactly.
 */
@Injectable()
export class LibraryCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Categories & shelves
  // ---------------------------------------------------------------------

  async listCategories(): Promise<ReferenceEntryResponseDto[]> {
    return this.prisma.libraryCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(
    dto: ReferenceEntryDto,
  ): Promise<ReferenceEntryResponseDto> {
    return this.prisma.libraryCategory.create({
      data: {
        name: dto.name,
      } as unknown as Prisma.LibraryCategoryUncheckedCreateInput,
    });
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await this.prisma.libraryCategory.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    await this.prisma.libraryCategory.delete({ where: { id } });
  }

  async listShelves(): Promise<ReferenceEntryResponseDto[]> {
    return this.prisma.libraryShelf.findMany({ orderBy: { name: 'asc' } });
  }

  async createShelf(
    dto: ReferenceEntryDto,
  ): Promise<ReferenceEntryResponseDto> {
    return this.prisma.libraryShelf.create({
      data: {
        name: dto.name,
      } as unknown as Prisma.LibraryShelfUncheckedCreateInput,
    });
  }

  async deleteShelf(id: string): Promise<void> {
    const shelf = await this.prisma.libraryShelf.findUnique({ where: { id } });
    if (!shelf) {
      throw new NotFoundException(`Shelf ${id} not found`);
    }
    await this.prisma.libraryShelf.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------
  // Books
  // ---------------------------------------------------------------------

  async listBooks(
    query: ListBooksQueryDto,
  ): Promise<PagedResult<BookResponseDto>> {
    const where: Prisma.BookWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.shelfId ? { shelfId: query.shelfId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { author: { contains: query.search, mode: 'insensitive' } },
              { isbn: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.book.findMany({
          where,
          include: { copies: true },
          orderBy: { title: 'asc' },
          skip,
          take,
        }),
      () => this.prisma.book.count({ where }),
    );
    return { items: result.items.map(toBookResponse), total: result.total };
  }

  async getBook(id: string): Promise<BookResponseDto> {
    return toBookResponse(await this.findBookOrThrow(id));
  }

  async createBook(dto: BookDto): Promise<BookResponseDto> {
    await this.assertReferencesExist(dto);
    const book = await this.prisma.book.create({
      data: toBookData(dto),
      include: { copies: true },
    });
    return toBookResponse(book);
  }

  async updateBook(id: string, dto: BookDto): Promise<BookResponseDto> {
    await this.findBookOrThrow(id);
    await this.assertReferencesExist(dto);
    const book = await this.prisma.book.update({
      where: { id },
      data: toBookData(dto),
      include: { copies: true },
    });
    return toBookResponse(book);
  }

  async removeBook(id: string): Promise<void> {
    const book = await this.findBookOrThrow(id);
    if (book.copies.length > 0) {
      throw new ConflictException(
        `Book ${id} still has ${book.copies.length} copy/copies registered — remove them first`,
      );
    }
    const pendingReservations = await this.prisma.reservation.count({
      where: { bookId: id, status: 'pending' },
    });
    if (pendingReservations > 0) {
      throw new ConflictException(
        `Book ${id} has ${pendingReservations} pending reservation(s) and cannot be deleted`,
      );
    }
    await this.prisma.book.delete({ where: { id } });
  }

  /** Real `Book` row (with `copies`), for `LibraryCirculationService`/`LibraryReservationsService`. */
  async findBookEntityOrThrow(id: string): Promise<BookWithCopies> {
    return this.findBookOrThrow(id);
  }

  // ---------------------------------------------------------------------
  // Copies
  // ---------------------------------------------------------------------

  async listCopies(bookId: string): Promise<CopyResponseDto[]> {
    await this.findBookOrThrow(bookId);
    return this.prisma.bookCopy.findMany({
      where: { bookId },
      orderBy: { barcode: 'asc' },
    });
  }

  async createCopy(bookId: string, dto: CopyDto): Promise<CopyResponseDto> {
    await this.findBookOrThrow(bookId);
    const existing = await this.prisma.bookCopy.findFirst({
      where: { barcode: dto.barcode },
    });
    if (existing) {
      throw new ConflictException(`Barcode "${dto.barcode}" is already in use`);
    }
    return this.prisma.bookCopy.create({
      data: {
        bookId,
        barcode: dto.barcode,
      } as unknown as Prisma.BookCopyUncheckedCreateInput,
    });
  }

  async removeCopy(bookId: string, copyId: string): Promise<void> {
    const copy = await this.prisma.bookCopy.findUnique({
      where: { id: copyId },
    });
    if (!copy || copy.bookId !== bookId) {
      throw new NotFoundException(`Copy ${copyId} not found on book ${bookId}`);
    }
    if (copy.status !== 'available') {
      throw new ConflictException(
        `Copy ${copyId} is ${copy.status} and cannot be removed — only an available copy can be`,
      );
    }
    await this.prisma.bookCopy.delete({ where: { id: copyId } });
  }

  // ---------------------------------------------------------------------

  private async findBookOrThrow(id: string): Promise<BookWithCopies> {
    const book = await this.prisma.book.findUnique({
      where: { id },
      include: { copies: true },
    });
    if (!book) {
      throw new NotFoundException(`Book ${id} not found`);
    }
    return book;
  }

  private async assertReferencesExist(dto: BookDto): Promise<void> {
    if (dto.categoryId) {
      const category = await this.prisma.libraryCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        throw new BadRequestException(`Category ${dto.categoryId} not found`);
      }
    }
    if (dto.shelfId) {
      const shelf = await this.prisma.libraryShelf.findUnique({
        where: { id: dto.shelfId },
      });
      if (!shelf) {
        throw new BadRequestException(`Shelf ${dto.shelfId} not found`);
      }
    }
  }
}

function toBookData(dto: BookDto): Prisma.BookUncheckedCreateInput {
  return {
    title: dto.title,
    isbn: dto.isbn,
    author: dto.author,
    publisher: dto.publisher,
    categoryId: dto.categoryId,
    shelfId: dto.shelfId,
    edition: dto.edition,
    description: dto.description,
  } as unknown as Prisma.BookUncheckedCreateInput;
}

export function toBookResponse(book: BookWithCopies): BookResponseDto {
  return {
    id: book.id,
    title: book.title,
    isbn: book.isbn,
    author: book.author,
    publisher: book.publisher,
    categoryId: book.categoryId,
    shelfId: book.shelfId,
    edition: book.edition,
    description: book.description,
    totalCopies: book.copies.length,
    availableCopies: book.copies.filter((c) => c.status === 'available').length,
  };
}
