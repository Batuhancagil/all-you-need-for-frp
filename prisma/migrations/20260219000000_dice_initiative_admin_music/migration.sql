-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'DICE';

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "createdByParticipantId" TEXT;
ALTER TABLE "Room" ADD COLUMN "backgroundMusicUrl" TEXT;

-- AlterTable
ALTER TABLE "Roll" ADD COLUMN "expression" TEXT;
ALTER TABLE "Roll" ADD COLUMN "modifier" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Roll" ALTER COLUMN "sides" SET DEFAULT 20;
ALTER TABLE "Roll" ALTER COLUMN "count" SET DEFAULT 1;

-- CreateTable
CREATE TABLE "InitiativeEntry" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "participantId" TEXT,
    "creatureName" TEXT,
    "expression" TEXT NOT NULL,
    "result" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InitiativeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InitiativeEntry_roomId_idx" ON "InitiativeEntry"("roomId");

-- AddForeignKey
ALTER TABLE "InitiativeEntry" ADD CONSTRAINT "InitiativeEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InitiativeEntry" ADD CONSTRAINT "InitiativeEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
