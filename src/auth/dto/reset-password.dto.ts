import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  // Length over composition rules (NIST 800-63B) — matches frontend/src/features/auth/schemas.ts'
  // newPasswordSchema exactly: an 8-character floor, no forced character-class requirements.
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password!: string;
}
