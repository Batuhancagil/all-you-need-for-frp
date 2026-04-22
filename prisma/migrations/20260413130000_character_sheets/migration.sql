ALTER TABLE "Participant"
ADD COLUMN "userId" TEXT;

CREATE TABLE "CharacterSheet" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participantId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterSheet_participantId_key" ON "CharacterSheet"("participantId");
CREATE UNIQUE INDEX "CharacterSheet_roomId_userId_key" ON "CharacterSheet"("roomId", "userId");
CREATE INDEX "CharacterSheet_roomId_idx" ON "CharacterSheet"("roomId");
CREATE INDEX "Participant_roomId_userId_idx" ON "Participant"("roomId", "userId");

ALTER TABLE "Participant"
ADD CONSTRAINT "Participant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "CharacterSheet"
ADD CONSTRAINT "CharacterSheet_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "CharacterSheet"
ADD CONSTRAINT "CharacterSheet_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "CharacterSheet"
ADD CONSTRAINT "CharacterSheet_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
