-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('player', 'admin');

-- CreateEnum
CREATE TYPE "CharacterClass" AS ENUM ('warrior', 'mage', 'ranger');

-- CreateEnum
CREATE TYPE "EquipmentSlot" AS ENUM ('hat', 'armor', 'pants', 'boots', 'necklace', 'ring1', 'ring2', 'belt', 'weapon1', 'weapon2');

-- CreateEnum
CREATE TYPE "UpgradeTowerBranch" AS ENUM ('damage', 'hp', 'defense', 'production', 'offlineDuration', 'goldXp');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "usernameKey" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'player',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Save" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gold" BIGINT NOT NULL DEFAULT 0,
    "currentFloor" INTEGER NOT NULL DEFAULT 1,
    "highestFloorCleared" INTEGER NOT NULL DEFAULT 0,
    "bestFloorEver" INTEGER NOT NULL DEFAULT 0,
    "heritageCount" INTEGER NOT NULL DEFAULT 0,
    "unlockedElements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastIdleCollectAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Save_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" UUID NOT NULL,
    "saveId" UUID NOT NULL,
    "class" "CharacterClass" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "saveId" UUID NOT NULL,
    "catalogId" TEXT NOT NULL,
    "upgradeLevel" INTEGER NOT NULL DEFAULT 0,
    "equippedById" UUID,
    "equippedSlot" "EquipmentSlot",
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSkill" (
    "characterId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "skillId" TEXT NOT NULL,
    "fusionElement" TEXT,

    CONSTRAINT "CharacterSkill_pkey" PRIMARY KEY ("characterId","position")
);

-- CreateTable
CREATE TABLE "ResourceStock" (
    "saveId" UUID NOT NULL,
    "resourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "fraction" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ResourceStock_pkey" PRIMARY KEY ("saveId","resourceId")
);

-- CreateTable
CREATE TABLE "Building" (
    "saveId" UUID NOT NULL,
    "buildingId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("saveId","buildingId")
);

-- CreateTable
CREATE TABLE "UpgradeTowerLevel" (
    "saveId" UUID NOT NULL,
    "branch" "UpgradeTowerBranch" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UpgradeTowerLevel_pkey" PRIMARY KEY ("saveId","branch")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameKey_key" ON "User"("usernameKey");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Save_userId_key" ON "Save"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_saveId_class_key" ON "Character"("saveId", "class");

-- CreateIndex
CREATE INDEX "Item_saveId_idx" ON "Item"("saveId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_equippedById_equippedSlot_key" ON "Item"("equippedById", "equippedSlot");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Save" ADD CONSTRAINT "Save_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_equippedById_fkey" FOREIGN KEY ("equippedById") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSkill" ADD CONSTRAINT "CharacterSkill_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceStock" ADD CONSTRAINT "ResourceStock_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeTowerLevel" ADD CONSTRAINT "UpgradeTowerLevel_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
