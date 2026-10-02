-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embeddedContentHash" TEXT,
ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "embeddingProvider" TEXT;
