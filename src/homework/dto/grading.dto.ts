import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `PATCH /homework/submissions/:id`'s body — `gradingSchema`. */
export class GradingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Grade is required' })
  @MaxLength(20)
  grade!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  feedback!: string;
}
