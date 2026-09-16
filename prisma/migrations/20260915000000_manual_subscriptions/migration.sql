-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'billing';

-- AlterEnum
BEGIN;
CREATE TYPE "SubscriptionStatus_new" AS ENUM ('ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED');
ALTER TABLE "public"."subscriptions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "SubscriptionStatus_new" USING ("status"::text::"SubscriptionStatus_new");
ALTER TYPE "SubscriptionStatus" RENAME TO "SubscriptionStatus_old";
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
DROP TYPE "public"."SubscriptionStatus_old";
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_planId_fkey";

-- DropIndex
DROP INDEX "billing_records_providerInvoiceId_key";

-- DropIndex
DROP INDEX "subscriptions_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "billing_records" DROP COLUMN "invoiceUrl",
DROP COLUMN "providerInvoiceId",
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedByName" TEXT,
ADD COLUMN     "confirmedByUserId" TEXT,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "schools" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Karachi',
ALTER COLUMN "currency" SET DEFAULT 'PKR';

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "cancelAtPeriodEnd",
DROP COLUMN "planId",
DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId",
DROP COLUMN "trialEndsAt",
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "lastReminderEmailAt" TIMESTAMP(3),
ADD COLUMN     "monthlyAmount" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- DropTable
DROP TABLE "plans";

-- DropEnum
DROP TYPE "PlanTier";

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "subscriptionGracePeriodDays" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

