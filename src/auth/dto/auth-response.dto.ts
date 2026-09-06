import { ApiProperty } from '@nestjs/swagger';

/** Matches `frontend/src/stores/sessionStore.ts`'s `SessionUser` field-for-field — no `avatarUrl` (not in the frontend type, despite `modules/auth.md`'s prose mentioning one). */
export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) activeBranchId!: string | null;
}

/** `POST /auth/login` and `GET /auth/me` response — `frontend/src/features/auth/api.ts`'s `LoginResponseDto`/`MeResponseDto`. The refresh token itself is never in this body; it's set as an httpOnly cookie. */
export class AuthSessionDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}

/** `GET /auth/me` doesn't carry a fresh `accessToken` — the caller already has a valid one (that's how it got past `JwtAuthGuard`). */
export class MeResponseDto {
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}

/** `POST /auth/refresh` response — `frontend/src/lib/http/apiClient.ts`'s `refreshAccessToken()` reads only this field. */
export class RefreshResponseDto {
  @ApiProperty() accessToken!: string;
}

/** `GET /auth/sessions` — `frontend/src/features/auth/api.ts`'s `SessionDevice`. */
export class SessionDeviceDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ nullable: true, type: String }) location!: string | null;
  @ApiProperty() lastActiveAt!: string;
  @ApiProperty() isCurrent!: boolean;
}
