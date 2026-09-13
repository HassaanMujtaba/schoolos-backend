import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './common/config/app-config.module';
import { RequestContextModule } from './common/context/request-context.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AnyPermissionsGuard } from './common/guards/any-permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { SchoolSetupModule } from './school-setup/school-setup.module';
import { DocumentsModule } from './documents/documents.module';
import { StudentsModule } from './students/students.module';
import { ParentsModule } from './parents/parents.module';
import { TeachersModule } from './teachers/teachers.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { TimetableModule } from './timetable/timetable.module';
import { AttendanceModule } from './attendance/attendance.module';
import { HomeworkModule } from './homework/homework.module';
import { ExaminationsModule } from './examinations/examinations.module';
import { FeesModule } from './fees/fees.module';
import { SearchModule } from './search/search.module';
import { CertificatesModule } from './certificates/certificates.module';
import { LibraryModule } from './library/library.module';
import { TransportModule } from './transport/transport.module';
import { InventoryModule } from './inventory/inventory.module';
import { HostelModule } from './hostel/hostel.module';
import { HrModule } from './hr/hr.module';
import { PayrollModule } from './payroll/payroll.module';
import { CommunicationModule } from './communication/communication.module';
import { ReportsModule } from './reports/reports.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    // Order matters: config first (everything else reads from it), then request context
    // (must be established before any guard runs), then Prisma/Redis (depend on both).
    AppConfigModule,
    RequestContextModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    TenantsModule,
    SchoolSetupModule,
    // Phase 3 — People + Documents primitive. DocumentsModule mounts first: students/ and
    // admissions/ both reference it (response DTOs read Document rows), not the other way round.
    DocumentsModule,
    StudentsModule,
    ParentsModule,
    TeachersModule,
    AdmissionsModule,
    // Phase 4 — Academics.
    TimetableModule,
    AttendanceModule,
    HomeworkModule,
    // Phase 5 — Examinations.
    ExaminationsModule,
    // Phase 6 — Fees & Finance (closes the PRD §65 MVP). AdmissionsModule (above) imports
    // FeesModule directly for the admissions↔fees ordering integration — Nest resolves that
    // regardless of this array's order, listed here to match the phase table.
    FeesModule,
    SearchModule,
    // Phase 7.1 — Documents & Certificates. The documents/ storage half was already built in
    // Phase 3 (see DocumentsModule above); this is just the certificate-generation half.
    CertificatesModule,
    // Phase 7.2 — Library.
    LibraryModule,
    // Phase 7.3 — Transport (vehicle/route management; live tracking is its own sub-phase).
    TransportModule,
    // Phase 7.4 — Inventory & Assets.
    InventoryModule,
    // Phase 7.5 — Hostel.
    HostelModule,
    // Phase 7.6 — HR & Payroll. PayrollModule imports HrModule directly for the
    // employee-existence/name/designation lookups a salary structure/payslip needs, same
    // FeesModule→AdmissionsModule cross-module pattern above.
    HrModule,
    PayrollModule,
    // Phase 7.7 — Communication (notifications, messaging, announcements, events/calendar, PTM)
    // + the `/ws` realtime gateway.
    CommunicationModule,
    // Phase 7.8 — Reports & Analytics. Imports FeesModule directly (see ReportsModule's own doc
    // comment) for the outstanding-balance reuse.
    ReportsModule,
    // Phase 7.9 — Platform Console (Super Admin). Imports AuthModule directly (see its own doc
    // comment), same cross-module-reuse pattern the phases above already establish.
    PlatformModule,
    // Phase 7.10+ feature modules mount here, in the order listed in
    // ../implementation-plan.md's phase table.
  ],
  providers: [
    // Rate limiting applies globally; individual auth endpoints (Phase 1) tighten this further
    // with their own stricter throttle per security-standards' "rate limiting on auth" guidance.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Verifies the access token and populates RequestContextService — must run before
    // PermissionsGuard, which reads the permission set that populates. `@Public()` routes
    // (health, login, refresh, forgot/reset-password) opt out explicitly.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Reads the permission set JwtAuthGuard just resolved from the verified token.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // OR counterpart to PermissionsGuard — see @RequireAnyPermission's own doc comment.
    { provide: APP_GUARD, useClass: AnyPermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
