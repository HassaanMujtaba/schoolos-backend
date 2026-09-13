import { Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PlatformUsageResponseDto } from './dto/usage.dto';

const BYTES_PER_GB = 1024 ** 3;

/**
 * `GET /platform/usage` — PRD §54's dashboard metrics. Not every field here has something real to
 * aggregate yet, and this deliberately doesn't fabricate a plausible-looking number for the ones
 * that don't — same "real, honestly-flagged placeholder" standard `examinations/grading-scale.ts`
 * and `certificates`' template set already established, not a new one invented here:
 *
 * - `activeSchools`/`activeUsers`/`activeStudents`/`mrr`/`storageUsedGb` are real aggregates over
 *   this database (`storageUsedGb` sums `DocumentVersion.sizeBytes` — every document/certificate
 *   upload this app has ever stored, the only real storage-consuming table that exists).
 * - `churnRatePct` is a real but simplified proxy — `canceled / total subscriptions ever created`,
 *   not a proper cohort-based rate (e.g. "of subscriptions active at the start of this month, what
 *   fraction canceled during it") — this codebase has no subscription-state-history table to
 *   compute that from yet (`Subscription` only holds current state, not a timeline of transitions).
 * - `apiCallsToday`/`errorRate24hPct`/`backgroundJobsPending` are `0` — there is no request-rate
 *   counter, error-rate tracker, or background job queue anywhere in this codebase yet (`grep -r
 *   bullmq` turns up nothing; PRD §46's background workers are still Phase 7.7's TODO'd
 *   notifications worker). `aiTokensToday` is `0` for the same reason `ai/` itself doesn't exist —
 *   it's Phase 7.10, explicitly last.
 */
@Injectable()
export class UsageService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async get(): Promise<PlatformUsageResponseDto> {
    const [
      activeSchools,
      activeUsers,
      activeStudents,
      activeSubscriptions,
      totalSubscriptions,
      canceledSubscriptions,
      storage,
    ] = await Promise.all([
      // "Active" here means "operationally on the platform" (not suspended), not "billing-status
      // ACTIVE" — a school straight out of onboarding is `TRIAL` and would otherwise never count
      // as active at all (nothing in this codebase yet flips `TRIAL` → `ACTIVE` once a trial
      // period ends, since there's no scheduled job to do it — see this file's own header comment
      // on what's real vs. placeholder here). `mrr` below is the metric that already excludes
      // trials on purpose; this one shouldn't double up on that distinction.
      this.platformPrisma.tenant.count({
        where: { status: { not: 'SUSPENDED' }, school: { isNot: null } },
      }),
      this.platformPrisma.user.count({
        where: { status: 'ACTIVE', tenant: { school: { isNot: null } } },
      }),
      this.platformPrisma.student.count({ where: { status: 'active' } }),
      this.platformPrisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        select: { plan: { select: { priceMonthly: true } } },
      }),
      this.platformPrisma.subscription.count(),
      this.platformPrisma.subscription.count({ where: { status: 'CANCELED' } }),
      this.platformPrisma.documentVersion.aggregate({
        _sum: { sizeBytes: true },
      }),
    ]);

    const mrr = activeSubscriptions.reduce(
      (sum, subscription) => sum + subscription.plan.priceMonthly,
      0,
    );
    const churnRatePct =
      totalSubscriptions === 0
        ? 0
        : (canceledSubscriptions / totalSubscriptions) * 100;

    return {
      activeSchools,
      activeUsers,
      activeStudents,
      mrr,
      churnRatePct,
      storageUsedGb: (storage._sum.sizeBytes ?? 0) / BYTES_PER_GB,
      apiCallsToday: 0,
      aiTokensToday: 0,
      errorRate24hPct: 0,
      backgroundJobsPending: 0,
    };
  }
}
