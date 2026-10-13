-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "bestLevel" INTEGER NOT NULL DEFAULT 1;

-- Les personnages existants ont au moins atteint leur niveau actuel.
UPDATE "Character" SET "bestLevel" = "level";
