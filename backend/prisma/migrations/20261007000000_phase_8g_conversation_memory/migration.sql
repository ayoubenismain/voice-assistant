-- Phase 8G: Conversation Memory & Context Management
-- Non-destructive: drops the old empty "messages" table and recreates as
-- "conversation_messages" with additional fields needed for Phase 8G.
-- The existing conversations table had no userId; it receives one now.
-- All ISSATSO document/chunk/embedding data is untouched.

-- Step 1: Drop FK from old messages table (if it still exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_conversationId_fkey";
  END IF;
END $$;

-- Step 2: Add new columns to conversations
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingClarification" JSONB,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Backfill updatedAt for existing rows (use createdAt as safe default)
UPDATE "conversations" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Now make userId NOT NULL (requires backfill first for existing rows)
-- For existing conversations without userId: generate a synthetic placeholder
UPDATE "conversations" SET "userId" = 'legacy-' || id WHERE "userId" IS NULL;
ALTER TABLE "conversations" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Step 3: Unique constraint on userId
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_userId_key" ON "conversations"("userId");

-- Step 4: Drop old messages table (was empty / placeholder in previous phases)
DROP TABLE IF EXISTS "messages";

-- Step 5: Create conversation_messages table
CREATE TABLE IF NOT EXISTS "conversation_messages" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role"           "Role" NOT NULL DEFAULT 'USER',
    "content"        TEXT NOT NULL,
    "responseType"   TEXT,
    "metadata"       JSONB,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- Step 6: Index for efficient context window queries
CREATE INDEX IF NOT EXISTS "conversation_messages_conversationId_createdAt_idx"
  ON "conversation_messages"("conversationId", "createdAt");

-- Step 7: Foreign key
ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
