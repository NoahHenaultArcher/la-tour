-- Uniques : amélioration plafonnée à +30 pour tous (balance.ts, UNIQUE_ITEMS.maxUpgrade).
-- Les Uniques déjà améliorés au-delà sont ramenés à +30.
UPDATE "Item" SET "upgradeLevel" = 30 WHERE "catalogId" LIKE '%-UNI' AND "upgradeLevel" > 30;
