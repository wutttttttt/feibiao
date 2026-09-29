ALTER TABLE "Good" DROP CONSTRAINT "good_occupancy";
ALTER TABLE "Good" ADD CONSTRAINT "good_occupancy" CHECK ("occupancy" IN ('FREE','INBOUND','LOAN','RESERVED','SOLD'));

CREATE TABLE "Intake" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVING',
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "intake_status" CHECK ("status" IN ('RECEIVING','ACTIVE','CLOSED'))
);

CREATE TABLE "IntakeItem" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "goodId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "declaredCents" BIGINT,
    "conditionNote" TEXT,
    "checkedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntakeItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "intake_item_status" CHECK ("status" IN ('PENDING','ACTIVE','RETURNED','SOLD','REJECTED')),
    CONSTRAINT "intake_item_declared" CHECK ("declaredCents" IS NULL OR "declaredCents" >= 0)
);

ALTER TABLE "SaleItem" ADD COLUMN "intakeItemId" TEXT;

CREATE UNIQUE INDEX "Intake_merchantId_number_key" ON "Intake"("merchantId", "number");
CREATE INDEX "Intake_merchantId_partnerId_status_idx" ON "Intake"("merchantId", "partnerId", "status");
CREATE INDEX "Intake_merchantId_dueAt_status_idx" ON "Intake"("merchantId", "dueAt", "status");
CREATE UNIQUE INDEX "IntakeItem_intakeId_lineNo_key" ON "IntakeItem"("intakeId", "lineNo");
CREATE INDEX "IntakeItem_merchantId_intakeId_status_idx" ON "IntakeItem"("merchantId", "intakeId", "status");
CREATE INDEX "IntakeItem_merchantId_goodId_status_idx" ON "IntakeItem"("merchantId", "goodId", "status");
CREATE UNIQUE INDEX "one_open_intake_per_good" ON "IntakeItem"("merchantId", "goodId") WHERE "status" IN ('PENDING','ACTIVE');
CREATE INDEX "SaleItem_intakeItemId_idx" ON "SaleItem"("intakeItemId");

ALTER TABLE "Intake" ADD CONSTRAINT "Intake_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntakeItem" ADD CONSTRAINT "IntakeItem_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntakeItem" ADD CONSTRAINT "IntakeItem_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_intakeItemId_fkey" FOREIGN KEY ("intakeItemId") REFERENCES "IntakeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
