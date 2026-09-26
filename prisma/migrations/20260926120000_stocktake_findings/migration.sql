CREATE TABLE "StocktakeFinding" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "goodId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reviewedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StocktakeFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StocktakeFinding_stocktakeId_code_key" ON "StocktakeFinding"("stocktakeId", "code");
CREATE INDEX "StocktakeFinding_merchantId_status_idx" ON "StocktakeFinding"("merchantId", "status");
ALTER TABLE "StocktakeFinding" ADD CONSTRAINT "StocktakeFinding_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
