import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

/**
 * Requires a real Postgres + Redis reachable at DATABASE_URL/REDIS_URL (see
 * ../docker-compose.yml and ../.env.example) — this is an integration test, not a unit test, per
 * ../implementation-plan.md's testing strategy ("E2E (supertest, per module)"). Run
 * `docker compose up -d` first; CI runs this against service containers (see
 * .github/workflows/ci.yml).
 */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // matches main.ts
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health reports Postgres and Redis as up', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health');

    expect(response.status).toBe(200);
    expect((response.body as { status: string }).status).toBe('ok');
  });
});
