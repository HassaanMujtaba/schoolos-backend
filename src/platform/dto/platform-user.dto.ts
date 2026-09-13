import { ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `GET /platform/users` — `frontend/src/features/platform/api.ts`'s `PlatformUser`. */
export class PlatformUserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class PagedPlatformUsersDto implements PagedResult<PlatformUserResponseDto> {
  @ApiProperty({ type: [PlatformUserResponseDto] })
  items!: PlatformUserResponseDto[];
  @ApiProperty() total!: number;
}
