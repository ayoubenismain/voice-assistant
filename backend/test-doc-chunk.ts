import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const chunk = await prisma.documentChunk.findFirst();
  console.log("Chunk metadata:", chunk?.embeddingProvider, chunk?.embeddingModel);
}
main().then(() => prisma.$disconnect());
