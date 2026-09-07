import { Injectable, NotFoundException } from '@nestjs/common';
import { Document, DocumentVersion, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { StorageService } from '../common/storage/storage.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateDocumentOwnerDto } from './dto/update-document-owner.dto';
import {
  DocumentResponseDto,
  DocumentVersionResponseDto,
} from './dto/document-response.dto';
import { assertUploadIsSafe } from './upload-validation';

type DocumentWithLatestVersion = Document & { versions: DocumentVersion[] };

/**
 * `frontend/src/features/documents/api.ts`'s REST surface — the shared upload/retrieval primitive
 * (`../../implementation-plan.md`'s Phase 3, "build early"). Every read resolves a fresh presigned
 * URL (`StorageService`) rather than returning a stored one — `DocumentVersion.storageKey` is
 * never exposed directly.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly storage: StorageService,
  ) {}

  async list(
    query: ListDocumentsQueryDto,
  ): Promise<PagedResult<DocumentResponseDto>> {
    const where: Prisma.DocumentWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.document.findMany({
          where,
          include: latestVersionInclude(),
          orderBy: { createdAt: query.sortDir ?? 'desc' },
          skip,
          take,
        }),
      () => this.prisma.document.count({ where }),
    );

    return {
      items: await Promise.all(result.items.map((doc) => this.toResponse(doc))),
      total: result.total,
    };
  }

  async get(id: string): Promise<DocumentResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async listVersions(id: string): Promise<DocumentVersionResponseDto[]> {
    await this.findOrThrow(id);
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { version: 'desc' },
    });
    return Promise.all(
      versions.map(async (v) => ({
        id: v.id,
        version: v.version,
        fileName: v.fileName,
        sizeBytes: v.sizeBytes,
        uploadedAt: v.createdAt.toISOString(),
        uploadedByLabel: v.uploadedByLabel,
        url: await this.storage.getSignedDownloadUrl(v.storageKey),
      })),
    );
  }

  async upload(
    dto: UploadDocumentDto,
    file: Express.Multer.File,
    user: AuthenticatedUser,
  ): Promise<DocumentResponseDto> {
    assertUploadIsSafe({
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });

    const tenantId = this.requireTenantId();
    const documentId = randomUUID();
    const storageKey = buildStorageKey(
      tenantId,
      dto.category,
      documentId,
      1,
      file.originalname,
    );

    await this.storage.putObject(storageKey, file.buffer, file.mimetype);

    // Nested `versions: { create: [...] }` — PrismaService's tenant-scoping extension only stamps
    // the top-level `Document.create`'s `data`, not this nested `DocumentVersion` row (the same
    // limit `BranchesService.create`'s own doc comment documents), so `tenantId` is set explicitly
    // here rather than relying on the extension.
    const document = await this.prisma.document.create({
      data: {
        id: documentId,
        category: dto.category,
        ownerId: dto.ownerId ?? null,
        ownerLabel: dto.ownerLabel ?? null,
        versions: {
          create: [
            {
              tenantId,
              version: 1,
              fileName: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              storageKey,
              uploadedByUserId: user.id,
              uploadedByLabel: user.name,
            },
          ],
        },
      } as unknown as Prisma.DocumentUncheckedCreateInput,
      include: latestVersionInclude(),
    });

    return this.toResponse(document);
  }

  async updateOwner(
    id: string,
    dto: UpdateDocumentOwnerDto,
  ): Promise<DocumentResponseDto> {
    await this.findOrThrow(id);
    const document = await this.prisma.document.update({
      where: { id },
      data: { ownerId: dto.ownerId, ownerLabel: dto.ownerLabel ?? null },
      include: latestVersionInclude(),
    });
    return this.toResponse(document);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: id },
      select: { storageKey: true },
    });
    // Best-effort object deletion before the DB row — an orphaned S3 object costs storage, an
    // orphaned DB row pointing at a deleted object is a broken download link, the worse failure
    // mode of the two.
    await Promise.all(
      versions.map((v) => this.storage.deleteObject(v.storageKey)),
    );
    await this.prisma.document.delete({ where: { id } });
  }

  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'DocumentsService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<DocumentWithLatestVersion> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: latestVersionInclude(),
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return document;
  }

  private async toResponse(
    document: DocumentWithLatestVersion,
  ): Promise<DocumentResponseDto> {
    const latest = document.versions[0];
    return {
      id: document.id,
      category: document.category,
      ownerId: document.ownerId,
      ownerLabel: document.ownerLabel,
      fileName: latest.fileName,
      mimeType: latest.mimeType,
      sizeBytes: latest.sizeBytes,
      version: latest.version,
      uploadedAt: latest.createdAt.toISOString(),
      uploadedByLabel: latest.uploadedByLabel,
      url: await this.storage.getSignedDownloadUrl(latest.storageKey),
    };
  }
}

function latestVersionInclude() {
  return {
    versions: { orderBy: { version: 'desc' as const }, take: 1 },
  } satisfies Prisma.DocumentInclude;
}

// S3/MinIO object keys don't need URL-encoding for these characters, but a stray path separator
// in a user-supplied filename would otherwise create a spoofed "directory" inside the tenant's
// prefix — strip anything that isn't alphanumeric/dot/dash/underscore.
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildStorageKey(
  tenantId: string,
  category: string,
  documentId: string,
  version: number,
  fileName: string,
): string {
  return `${tenantId}/${category}/${documentId}/v${version}/${sanitizeFileName(fileName)}`;
}
