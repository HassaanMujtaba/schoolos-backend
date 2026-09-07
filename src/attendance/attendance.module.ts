import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

@Module({
  controllers: [AttendanceController, LeaveController],
  providers: [AttendanceService, LeaveService],
})
export class AttendanceModule {}
