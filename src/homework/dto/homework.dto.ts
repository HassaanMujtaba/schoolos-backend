import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * `frontend/src/features/homework/schemas.ts`'s `homeworkSchema` — one DTO for create and edit,
 * same convention as `StudentDto`. `links` arrives already flattened to `string[]`
 * (`api.ts`'s `toHomeworkPayload` turns the form's `{ url }[]` into this on the wire).
 * `attachments` isn't part of this payload at all — see `Homework.attachments`'s own schema doc
 * comment for why.
 */
export class HomeworkDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  links!: string[];

  @ApiProperty()
  @IsDateString({ strict: false }, { message: 'Deadline is required' })
  deadline!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one class' })
  @IsString({ each: true })
  classIds!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  sectionIds!: string[];
}
