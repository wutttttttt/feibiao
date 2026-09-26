-- AlterTable
ALTER TABLE "MoneyEntry" ADD COLUMN     "appliedCents" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OpeningAllocation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "moneyEntryId" TEXT NOT NULL,
    "receiptId" TEXT,
    "paymentId" TEXT,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpeningAllocation_merchantId_moneyEntryId_idx" ON "OpeningAllocation"("merchantId", "moneyEntryId");

-- AddForeignKey
ALTER TABLE "OpeningAllocation" ADD CONSTRAINT "OpeningAllocation_moneyEntryId_fkey" FOREIGN KEY ("moneyEntryId") REFERENCES "MoneyEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningAllocation" ADD CONSTRAINT "OpeningAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningAllocation" ADD CONSTRAINT "OpeningAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
