import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `frontend/src/features/auth/api.ts`'s `LoginPayload` — `identifier` is either an email or a phone number, matching `schemas.ts`'s combined validator. */
export class LoginDto {
  @ApiProperty({ example: 'admin@school.example' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  password!: string;
}
