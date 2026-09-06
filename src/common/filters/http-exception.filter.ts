import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId?: string;
  path: string;
  timestamp: string;
}

/**
 * One consistent error shape for every failure, matching what `frontend/src/components/ui/
 * ErrorState` is written to render — a caller never has to branch on "is this a validation error
 * or a server error" to display something sensible. Also the log point: an unexpected (non-
 * `HttpException`) error is logged with its `requestId` so it can be correlated with the audit
 * log / request-id response header set by `RequestContextMiddleware`, without ever logging the
 * request body itself (security-standards A09: logs must never capture tokens/PII).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = response.getHeader('x-request-id') as string | undefined;

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody = isHttpException ? exception.getResponse() : undefined;
    const message =
      typeof responseBody === 'string'
        ? responseBody
        : ((responseBody as { message?: string | string[] })?.message ??
          'Internal server error');

    if (!isHttpException) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode,
      message,
      // statusCode is always either a fixed HttpStatus.INTERNAL_SERVER_ERROR or the numeric
      // status a NestJS HttpException itself carries — never derived from user input.
      // eslint-disable-next-line security/detect-object-injection
      error: HttpStatus[statusCode] ?? 'Error',
      requestId,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }
}
