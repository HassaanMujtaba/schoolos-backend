-- CreateEnum
CREATE TYPE "CertificateTemplate" AS ENUM ('bonafide', 'enrollment', 'character', 'transfer', 'leaving', 'achievement', 'custom');

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "template" "CertificateTemplate" NOT NULL,
    "title" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "certificateNumber" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "generatedByUserId" TEXT,
    "generatedByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verifyCode_key" ON "certificates"("verifyCode");

-- CreateIndex
CREATE INDEX "certificates_tenantId_idx" ON "certificates"("tenantId");

-- CreateIndex
CREATE INDEX "certificates_studentId_idx" ON "certificates"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_tenantId_certificateNumber_key" ON "certificates"("tenantId", "certificateNumber");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
