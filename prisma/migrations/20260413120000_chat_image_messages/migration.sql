-- Alter chat messages so image-only posts are allowed
ALTER TABLE "ChatMessage"
ALTER COLUMN "content" DROP NOT NULL;

-- Store an optional inline image for channel messages
ALTER TABLE "ChatMessage"
ADD COLUMN "imageDataUrl" TEXT;
