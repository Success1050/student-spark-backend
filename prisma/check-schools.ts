import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schools = await prisma.school.findMany({
    select: {
      id: true,
      name: true,
      schoolCode: true,
      institutionType: true,
      masterSecretKey: true,
    },
  });
  console.log('EXISTING SCHOOLS:', JSON.stringify(schools, null, 2));

  const usersCount = await prisma.user.count();
  console.log('TOTAL USERS IN DB:', usersCount);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
