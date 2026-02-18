-- AlterTable
ALTER TABLE "InitiativeEntry" ADD COLUMN "isAlive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "initiativeCurrentEntryId" TEXT;
ALTER TABLE "Room" ADD COLUMN "initiativeTurnCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Room_initiativeCurrentEntryId_key" ON "Room"("initiativeCurrentEntryId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_initiativeCurrentEntryId_fkey" FOREIGN KEY ("initiativeCurrentEntryId") REFERENCES "InitiativeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
