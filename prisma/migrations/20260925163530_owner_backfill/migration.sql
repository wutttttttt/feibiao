UPDATE "Good" SET "currentOwnerKind" = 'PARTNER', "currentOwnerPartnerId" = "ownerPartnerId" WHERE "ownershipKind" = 'CONSIGN' AND "occupancy" <> 'SOLD';
