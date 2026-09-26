ALTER TABLE "Partner" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "Partner_merchantId_externalId_key" ON "Partner"("merchantId","externalId");
