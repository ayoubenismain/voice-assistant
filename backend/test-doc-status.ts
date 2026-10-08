import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const docs = await prisma.document.findMany();
  console.log("Documents:", docs);
}
main().then(() => prisma.$disconnect());
