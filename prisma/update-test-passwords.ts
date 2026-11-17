import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hash123 = await bcrypt.hash('password123', 10);

  const updated = await prisma.user.updateMany({
    where: {
      OR: [
        { email: { contains: 'futo.studentspark.ng' } },
        { email: { contains: 'studentspark.ng' } },
        { email: 'bursar@futo.studentspark.ng' },
      ],
    },
    data: {
      passwordHash: hash123,
      mustChangePassword: false,
    },
  });

  console.log(`✅ Successfully updated ${updated.count} test users password to "password123"!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
