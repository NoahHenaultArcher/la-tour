-- CreateTable
CREATE TABLE "CombatSession" (
    "saveId" UUID NOT NULL,
    "floor" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CombatSession_pkey" PRIMARY KEY ("saveId")
);

-- AddForeignKey
ALTER TABLE "CombatSession" ADD CONSTRAINT "CombatSession_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "Save"("id") ON DELETE CASCADE ON UPDATE CASCADE;
