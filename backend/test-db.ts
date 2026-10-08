import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const docs = await prisma.document.findMany();
  console.log(docs);
}
main();
