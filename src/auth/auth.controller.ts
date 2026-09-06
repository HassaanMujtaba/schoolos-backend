import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthService } from './auth.service';
import { parseDurationSeconds } from './utils/duration';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  AuthSessionDto,
  MeResponseDto,
  RefreshResponseDto,
  SessionDeviceDto,
} from './dto/auth-response.dto';

const REFRESH_COOKIE_NAME = 'refresh_token';
// Scoped to the versioned auth routes that actually read it — never sent on unrelated requests.
// Hardcodes the `/v1` version segment main.ts's `enableVersioning` adds; revisit together if that
// ever changes.
const REFRESH_COOKIE_PATH = '/v1/auth';
// A tight throttle on top of the global 100/min default (app.module.ts) — auth endpoints are the
// classic brute-force/enumeration target (security-standards: "rate limiting: on auth...").
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly refreshCookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    config: AppConfigService,
  ) {
    this.refreshCookieOptions = {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: parseDurationSeconds(config.jwtRefreshTtl) * 1000,
    };
  }

  @Post('login')
  @Public()
  @SkipAudit() // request body is credentials, not a business mutation — see decorator's own doc comment
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { session, refreshCookieValue } = await this.authService.login(
      dto.identifier,
      dto.password,
      {
        userAgent: req.headers['user-agent'] ?? null,
        ip: req.ip ?? null,
      },
    );
    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshCookieValue,
      this.refreshCookieOptions,
    );
    return session;
  }

  @Post('refresh')
  @Public()
  @SkipAudit() // pre-tenant-context, like login — see that route's own comment
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    // Fixed constant key, not user-controlled — safe indexing.
    // eslint-disable-next-line security/detect-object-injection
    const cookieValue = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    const { accessToken, refreshCookieValue } =
      await this.authService.refresh(cookieValue);
    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshCookieValue,
      this.refreshCookieOptions,
    );
    return { accessToken };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): MeResponseDto {
    return this.authService.me(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(user.sessionId, user.id);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user.id);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @Post('forgot-password')
  @Public()
  @SkipAudit() // pre-tenant-context, like login — see that route's own comment
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword(dto.identifier);
  }

  @Post('reset-password')
  @Public()
  @SkipAudit() // request body carries the reset token + new password
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password);
  }

  @Get('sessions')
  async sessions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SessionDeviceDto[]> {
    return this.authService.listSessions(user.id, user.sessionId);
  }
}
