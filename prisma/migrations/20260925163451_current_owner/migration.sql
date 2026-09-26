-- AlterTable
ALTER TABLE "Good" ADD COLUMN     "currentOwnerKind" TEXT NOT NULL DEFAULT 'MERCHANT',
ADD COLUMN     "currentOwnerPartnerId" TEXT;
