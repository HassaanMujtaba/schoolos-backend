import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller';
import { ReportCardsController } from './report-cards.controller';
import { ExaminationsService } from './examinations.service';

@Module({
  controllers: [ExamsController, ReportCardsController],
  providers: [ExaminationsService],
})
export class ExaminationsModule {}
