import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `GET /leave/student` — two documented shapes on one endpoint, per `attendance/api.ts`'s own
 * split: `?page=&pageSize=&status=` (the teacher/admin review queue, paginated — `listLeaveRequests`)
 * or `?studentId=` (a student/parent's own history, a plain array — `listMyLeaveRequests`;
 * `studentId` accepts `'me'`).
 */
export class ListLeaveQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}
