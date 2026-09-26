-- CreateTable
CREATE TABLE "SaleFee" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleFee_merchantId_saleId_idx" ON "SaleFee"("merchantId", "saleId");

-- AddForeignKey
ALTER TABLE "SaleFee" ADD CONSTRAINT "SaleFee_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
