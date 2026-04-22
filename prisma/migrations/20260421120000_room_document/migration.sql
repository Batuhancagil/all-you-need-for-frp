CREATE TYPE "RoomType" AS ENUM ('TTRPG', 'DOCUMENT');

ALTER TABLE "Room"
ADD COLUMN "type" "RoomType" NOT NULL DEFAULT 'TTRPG';

CREATE TABLE "RoomDocument" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "yjsState" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomDocument_roomId_key" ON "RoomDocument"("roomId");

ALTER TABLE "RoomDocument"
ADD CONSTRAINT "RoomDocument_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
