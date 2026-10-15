-- AlterTable : progression dans l'Abysse (étages sans fin après la tour).
ALTER TABLE "Save" ADD COLUMN     "abyssFloor" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "abyssCleared" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bestAbyssFloor" INTEGER NOT NULL DEFAULT 0;
