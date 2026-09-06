import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PlatformPrismaService } from './platform-prisma.service';

@Global()
@Module({
  providers: [PrismaService, PlatformPrismaService],
  exports: [PrismaService, PlatformPrismaService],
})
export class PrismaModule {}
