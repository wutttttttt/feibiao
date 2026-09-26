CREATE UNIQUE INDEX "one_open_loan_per_good" ON "LoanItem"("merchantId","goodId") WHERE "status" = 'OUT';
CREATE UNIQUE INDEX "one_active_sale_per_good" ON "SaleItem"("merchantId","goodId") WHERE "status" IN ('ACTIVE','ADJUSTED');
ALTER TABLE "Good" ADD CONSTRAINT "good_ownership_kind" CHECK ("ownershipKind" IN ('OWN','CONSIGN'));
ALTER TABLE "Good" ADD CONSTRAINT "good_occupancy" CHECK ("occupancy" IN ('FREE','LOAN','RESERVED','SOLD'));
ALTER TABLE "Good" ADD CONSTRAINT "good_quality" CHECK ("quality" IN ('NORMAL','HOLD','DAMAGED'));
ALTER TABLE "Receipt" ADD CONSTRAINT "receipt_amounts" CHECK ("amountCents" > 0 AND "allocatedCents" >= 0 AND "allocatedCents" <= "amountCents");
ALTER TABLE "SaleItem" ADD CONSTRAINT "sale_item_amounts" CHECK ("grossCents" > 0 AND "discountCents" >= 0 AND "netCents" = "grossCents" - "discountCents" AND "returnedCents" >= 0 AND "paidCents" >= 0 AND "returnedCents" + "paidCents" <= "netCents");
ALTER TABLE "Payable" ADD CONSTRAINT "payable_amounts" CHECK ("amountCents" >= 0 AND "paidCents" >= 0);
