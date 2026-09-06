import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Source maps are fine server-side (unlike the frontend build, which disables them) — this
    // process never ships to a client.
    bufferLogs: true,
  });

  const config = app.get(AppConfigService);

  // SECURITY.md / security-standards: locked-down headers, no framework defaults left open.
  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true, // required for the httpOnly refresh-token cookie
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Reject invalid input rather than silently coercing it (security-standards: "reject, don't
  // sanitize-and-continue"). whitelist+forbidNonWhitelisted strips/rejects any field a DTO didn't
  // declare, so an extra client-supplied field (e.g. a spoofed tenantId) never reaches a handler.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  if (!config.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SchoolOS API')
      .setDescription(
        'See ../backend/implementation-plan.md for the phase-by-phase build plan this API follows.',
      )
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'Failed to start application',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
