import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@school.example' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;
}
