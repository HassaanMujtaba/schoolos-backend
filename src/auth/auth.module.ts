import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigModule } from '../common/config/app-config.module';
import { AppConfigService } from '../common/config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { parseDurationSeconds } from './utils/duration';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtAccessSecret,
        // Seconds, not the raw `"15m"` string — @nestjs/jwt's `expiresIn` type only accepts a
        // number or its own branded `ms`-pattern string literal type, which `AppConfigService`'s
        // plain `string` doesn't satisfy; `parseDurationSeconds` is the same conversion
        // `SessionService` already does for the refresh-token TTL.
        signOptions: { expiresIn: parseDurationSeconds(config.jwtAccessTtl) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
