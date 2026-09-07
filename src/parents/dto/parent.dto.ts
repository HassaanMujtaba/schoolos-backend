import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** `frontend/src/features/parents/schemas.ts`'s `parentSchema` — one DTO for create and edit. */
export class ParentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Parent name is required' })
  @MaxLength(200)
  name!: string;

  // `.or(z.literal(''))` on the frontend — email is optional *content*, not an optional field
  // (always present in the payload, may be `''`). `@ValidateIf` skips `@IsEmail` for that one
  // value rather than making the field itself optional.
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @ValidateIf((_, value: string) => value !== '')
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @MaxLength(30)
  phone!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  address!: string;
}
