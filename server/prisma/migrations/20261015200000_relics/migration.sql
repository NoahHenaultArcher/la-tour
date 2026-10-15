-- CreateTable : reliques et œufs de dragon (une fois chacun par compte, 6 emplacements).
CREATE TABLE "Relic" (
    "saveId" UUID NOT NULL,
    "relicId" TEXT NOT NULL,
    "slot" INTEGER,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Relic_pkey" PRIMARY KEY ("saveId","relicId")
);

-- CreateIndex : un emplacement ne porte qu'une relique (plusieurs reliques peuvent être non équipées).
CREATE UNIQUE INDEX "Relic_saveId_slot_key" ON "Relic"("saveId", "slot");

-- AddForeignKey
ALTER TABLE "Relic" ADD CONSTRAINT "Relic_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
