-- Évolutions de classes (héritages 10 et 20) : 3e arme du Maître d'armes, double fusion de l'Archimage.
ALTER TYPE "EquipmentSlot" ADD VALUE 'weapon3';
ALTER TABLE "CharacterSkill" ADD COLUMN "fusionElement2" TEXT;

-- CreateTable : ventes récentes, pour pouvoir les annuler (rachat au même prix).
CREATE TABLE "SoldItem" (
    "id" UUID NOT NULL,
    "saveId" UUID NOT NULL,
    "catalogId" TEXT NOT NULL,
    "upgradeLevel" INTEGER NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "gold" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SoldItem_saveId_idx" ON "SoldItem"("saveId");

-- AddForeignKey
ALTER TABLE "SoldItem" ADD CONSTRAINT "SoldItem_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
