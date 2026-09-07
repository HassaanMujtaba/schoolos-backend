import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../config/app-config.service';

const SIGNED_URL_TTL_SECONDS = 900; // 15 minutes — long enough to load a document detail page,
// short enough that a leaked link (chat, screenshot) doesn't stay valid indefinitely.

/**
 * PRD §31/§46's object storage — S3 in prod, MinIO in dev (`../../../implementation-plan.md`'s
 * tech-stack table), one thin wrapper so `documents/` never touches the AWS SDK directly. Every
 * read goes through a presigned URL (`getSignedDownloadUrl`) rather than a public bucket/object —
 * `Document`/`DocumentVersion` never store a directly-fetchable URL, only the S3 key
 * (`schema.prisma`'s own doc comment on `DocumentVersion.storageKey`).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfigService) {
    this.bucket = config.s3Bucket;
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      // MinIO (and most S3-compatible stores) need path-style addressing
      // (`http://host:port/bucket/key`, not `bucket.host`) — real AWS S3 accepts either, so this
      // is safe to force in every environment rather than branching on which store this is.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    });
  }

  /**
   * Dev ergonomics only: auto-creates the bucket if it doesn't exist yet, so
   * `docker compose up -d && npm run dev` stays the one-command "clone and go" bar
   * `implementation-plan.md`'s Phase 0 deliverables set, without a manual `mc mb` step. Never
   * destructive (only creates), and never fails app startup — a genuinely unreachable/misconfigured
   * store surfaces through `GET /health`'s storage check instead, the same "boot even if a
   * downstream dependency is briefly down, let health checks report it" shape `RedisHealthIndicator`
   * already established.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (error) {
        this.logger.warn(
          `Storage bucket "${this.bucket}" unreachable at startup — uploads will fail until this ` +
            `is fixed, but the app boots anyway (GET /health reports storage status): ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** `HealthController`'s storage reachability check (PRD §61) — Phase 0's own gap, closed here. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
