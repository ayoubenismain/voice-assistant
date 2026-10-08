import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.documentChunk.count();
  console.log("DocumentChunks count:", count);
}
main().then(() => prisma.$disconnect());
