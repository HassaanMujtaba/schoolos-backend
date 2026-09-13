-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('available', 'issued', 'lost', 'damaged');

-- CreateEnum
CREATE TYPE "LibraryMemberType" AS ENUM ('student', 'teacher');

-- CreateEnum
CREATE TYPE "LibraryMemberStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('none', 'pending', 'paid', 'waived');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('ok', 'lost', 'damaged');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('pending', 'fulfilled', 'cancelled');

-- CreateTable
CREATE TABLE "library_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_shelves" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_books" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isbn" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL,
    "publisher" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT NOT NULL DEFAULT '',
    "shelfId" TEXT NOT NULL DEFAULT '',
    "edition" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_book_copies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberType" "LibraryMemberType" NOT NULL,
    "personId" TEXT NOT NULL,
    "personLabel" TEXT NOT NULL,
    "maxBooks" INTEGER NOT NULL DEFAULT 3,
    "loanPeriodDays" INTEGER NOT NULL DEFAULT 14,
    "status" "LibraryMemberStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_loans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issuedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATE NOT NULL,
    "returnedAt" DATE,
    "returnCondition" "ReturnCondition",
    "fineAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fineStatus" "FineStatus" NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reservedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReservationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_settings" (
    "tenantId" TEXT NOT NULL,
    "finePerDayRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxFine" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "library_categories_tenantId_idx" ON "library_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "library_categories_tenantId_name_key" ON "library_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "library_shelves_tenantId_idx" ON "library_shelves"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "library_shelves_tenantId_name_key" ON "library_shelves"("tenantId", "name");

-- CreateIndex
CREATE INDEX "library_books_tenantId_idx" ON "library_books"("tenantId");

-- CreateIndex
CREATE INDEX "library_book_copies_tenantId_idx" ON "library_book_copies"("tenantId");

-- CreateIndex
CREATE INDEX "library_book_copies_bookId_idx" ON "library_book_copies"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "library_book_copies_tenantId_barcode_key" ON "library_book_copies"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "library_members_tenantId_idx" ON "library_members"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "library_members_tenantId_memberType_personId_key" ON "library_members"("tenantId", "memberType", "personId");

-- CreateIndex
CREATE INDEX "library_loans_tenantId_idx" ON "library_loans"("tenantId");

-- CreateIndex
CREATE INDEX "library_loans_copyId_idx" ON "library_loans"("copyId");

-- CreateIndex
CREATE INDEX "library_loans_memberId_idx" ON "library_loans"("memberId");

-- CreateIndex
CREATE INDEX "library_reservations_tenantId_idx" ON "library_reservations"("tenantId");

-- CreateIndex
CREATE INDEX "library_reservations_bookId_idx" ON "library_reservations"("bookId");

-- CreateIndex
CREATE INDEX "library_reservations_memberId_idx" ON "library_reservations"("memberId");

-- AddForeignKey
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_shelves" ADD CONSTRAINT "library_shelves_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_book_copies" ADD CONSTRAINT "library_book_copies_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_members" ADD CONSTRAINT "library_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "library_book_copies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "library_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reservations" ADD CONSTRAINT "library_reservations_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reservations" ADD CONSTRAINT "library_reservations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "library_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
