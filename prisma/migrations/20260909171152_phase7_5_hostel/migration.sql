-- CreateEnum
CREATE TYPE "HostelType" AS ENUM ('boys', 'girls', 'mixed');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('dormitory', 'shared', 'private');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('active', 'vacated');

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('maintenance', 'food', 'discipline', 'other');

-- CreateTable
CREATE TABLE "hostels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HostelType" NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "wardenName" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_rooms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "floorLabel" TEXT NOT NULL DEFAULT '',
    "roomNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hostel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "bedNumber" INTEGER NOT NULL,
    "allocatedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vacatedAt" DATE,
    "status" "AllocationStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hostel_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_visitors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "residentStudentId" TEXT NOT NULL,
    "residentLabel" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),

    CONSTRAINT "hostel_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_complaints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "roomId" TEXT,
    "residentStudentId" TEXT,
    "residentLabel" TEXT,
    "category" "ComplaintCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "hostel_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hostels_tenantId_idx" ON "hostels"("tenantId");

-- CreateIndex
CREATE INDEX "hostel_rooms_tenantId_idx" ON "hostel_rooms"("tenantId");

-- CreateIndex
CREATE INDEX "hostel_rooms_hostelId_idx" ON "hostel_rooms"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_rooms_tenantId_hostelId_roomNumber_key" ON "hostel_rooms"("tenantId", "hostelId", "roomNumber");

-- CreateIndex
CREATE INDEX "hostel_allocations_tenantId_idx" ON "hostel_allocations"("tenantId");

-- CreateIndex
CREATE INDEX "hostel_allocations_roomId_idx" ON "hostel_allocations"("roomId");

-- CreateIndex
CREATE INDEX "hostel_allocations_studentId_idx" ON "hostel_allocations"("studentId");

-- CreateIndex
CREATE INDEX "hostel_visitors_tenantId_idx" ON "hostel_visitors"("tenantId");

-- CreateIndex
CREATE INDEX "hostel_visitors_residentStudentId_idx" ON "hostel_visitors"("residentStudentId");

-- CreateIndex
CREATE INDEX "hostel_complaints_tenantId_idx" ON "hostel_complaints"("tenantId");

-- CreateIndex
CREATE INDEX "hostel_complaints_hostelId_idx" ON "hostel_complaints"("hostelId");

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "hostel_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "hostel_allocations_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hostel_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_complaints" ADD CONSTRAINT "hostel_complaints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_complaints" ADD CONSTRAINT "hostel_complaints_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
