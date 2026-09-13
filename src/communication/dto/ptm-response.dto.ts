import { ApiProperty } from '@nestjs/swagger';

/**
 * `frontend/src/features/communication/api.ts`'s `PtmSlot` (also `PtmBooking` — "a booking is a
 * booked `PtmSlot`, same record, not a second entity"). `bookedByParentId`/`bookedByParentLabel`
 * are named for a parent even though a Student session can also book their own meeting — see
 * `schema.prisma`'s `PtmSlot.bookedByUserId` doc comment for why the wire name predates that.
 */
export class PtmSlotResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() teacherId!: string;
  @ApiProperty() teacherLabel!: string;
  @ApiProperty() date!: string;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty({ nullable: true }) bookedByParentId!: string | null;
  @ApiProperty({ nullable: true }) bookedByParentLabel!: string | null;
  @ApiProperty({ nullable: true }) studentLabel!: string | null;
  @ApiProperty() notes!: string;
  @ApiProperty() followUpAction!: string;
}
