import { PrismaClient, InstitutionType, MarketplaceVisibilityScope, MarketplaceItemStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding rich Public Store materials...');

  let seller = await prisma.user.findUnique({
    where: { email: 'author.publisher@studentspark.ng' },
  });
  if (!seller) {
    seller = await prisma.user.create({
      data: {
        email: 'author.publisher@studentspark.ng',
        fullName: 'Spark Academic Publishing House',
        username: 'spark_publishers',
        role: 'TEACHER',
        referralCode: 'SPARKPUB' + Date.now().toString().slice(-4),
      },
    });
  }

  const futo = await prisma.school.findFirst({
    where: { OR: [{ schoolCode: 'FUTO-01' }, { name: { contains: 'Federal University of Technology', mode: 'insensitive' } }] },
  });

  const kc = await prisma.school.findFirst({
    where: { OR: [{ schoolCode: 'KCL-01' }, { name: { contains: 'King', mode: 'insensitive' } }] },
  });

  const publicMaterials = [
    {
      title: 'FUTO 10-Year Past Questions & Detailed Solutions (MTH 101, PHY 101, CHM 101 & GST 101)',
      description: 'Official 10-year compiled past examination questions and step-by-step verified solutions for FUTO 100L engineering and physical science students. Includes examiner marking guides and shortcut methods.',
      authorName: 'Engr. Dr. Adeyemi Balogun (FUTO)',
      courseCode: 'MTH 101 / PHY 101',
      institutionType: InstitutionType.UNIVERSITY,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'School of Engineering & Engineering Technology (SEET)',
      departmentName: 'Electrical & Electronic Engineering',
      levelName: '100L',
      termOrSemester: 'Harmattan Semester',
      priceKobo: 0,
      isFree: true,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/futo_100l_pq.pdf',
      pageCount: 145,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: futo?.id,
    },
    {
      title: 'UNILAG 100L General Mathematics & Calculus Solved Past Questions (MAT 101)',
      description: 'Comprehensive 8-year compendium of University of Lagos MAT 101 past examination questions with complete proofs, integration techniques, and limits.',
      authorName: 'Prof. A. O. Adeleke (UNILAG Dept of Mathematics)',
      courseCode: 'MAT 101',
      institutionType: InstitutionType.UNIVERSITY,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'Faculty of Science',
      departmentName: 'Mathematics',
      levelName: '100L',
      termOrSemester: 'First Semester',
      priceKobo: 45000, // ₦450
      isFree: false,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/unilag_mat101_pq.pdf',
      pageCount: 96,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: null,
    },
    {
      title: 'WAEC & NECO Complete Senior Secondary Past Questions & Model Answers: Mathematics & English',
      description: 'Over 1,200 WAEC and NECO past theory and objective questions covering 2012-2024 with detailed marking schemes and examiner essay grading criteria.',
      authorName: 'Mrs. Folake Daniel (King’s College Lagos)',
      courseCode: 'WAEC-MTH-ENG',
      institutionType: InstitutionType.SECONDARY,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'Senior Secondary Department',
      departmentName: 'Science & Arts',
      levelName: 'SS 3 / WAEC',
      termOrSemester: 'Final Term',
      priceKobo: 0,
      isFree: true,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/waec_math_english_pq.pdf',
      pageCount: 220,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: kc?.id,
    },
    {
      title: 'YABATECH National Diploma Electrical Circuit Theory & Electronics (EEC 115) Handout',
      description: 'Practical workbook on Kirchhoff’s laws, AC/DC circuit theorems, semiconductor diodes, transistor biasing, and laboratory oscilloscope measurements.',
      authorName: 'Engr. K. O. Balogun',
      courseCode: 'EEC 115',
      institutionType: InstitutionType.POLYTECHNIC,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'School of Engineering',
      departmentName: 'Electrical Engineering',
      levelName: 'ND 1',
      termOrSemester: 'First Semester',
      priceKobo: 50000, // ₦500
      isFree: false,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/yabatech_eec115.pdf',
      pageCount: 78,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: null,
    },
    {
      title: 'Essential Engineering Mathematics: Advanced Calculus, Vectors & Differential Equations',
      description: 'Standard textbook for tertiary engineering faculties in Nigeria. Covers Laplace transforms, Fourier series, partial differential equations, and linear algebra applications.',
      authorName: 'Dr. Chidiebere Okonkwo',
      courseCode: 'ENG 201',
      institutionType: InstitutionType.UNIVERSITY,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'Faculty of Engineering',
      departmentName: 'Engineering Sciences',
      levelName: '200L / 300L',
      termOrSemester: 'Full Year',
      priceKobo: 150000, // ₦1,500
      isFree: false,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/engineering_mathematics.pdf',
      pageCount: 310,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: futo?.id,
    },
    {
      title: 'JAMB UTME Complete Past Questions & Explanations: English, Biology, Chemistry & Physics',
      description: 'All-in-one CBT preparation masterclass with high-yield questions, mnemonic summaries, and quick elimination tactics for university admission seekers.',
      authorName: 'Spark Masterclass Editorial Team',
      courseCode: 'JAMB-CBT-ALL',
      institutionType: InstitutionType.SECONDARY,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'Admission Prep',
      departmentName: 'Medical & Pure Sciences',
      levelName: 'UTME Aspirant',
      termOrSemester: 'Annual',
      priceKobo: 80000, // ₦800
      isFree: false,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/jamb_cbt_compendium.pdf',
      pageCount: 260,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: null,
    },
    {
      title: 'Introduction to Nigerian Commercial Law: Sale of Goods, Agency & Hire Purchase',
      description: 'Core law faculty manual examining statutory principles of Nigerian commercial law, landmark supreme court judgments, consumer protection regulations, and contract enforceability.',
      authorName: 'Barrister N. E. Eze',
      courseCode: 'LAW 203',
      institutionType: InstitutionType.UNIVERSITY,
      visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
      facultyName: 'Faculty of Law',
      departmentName: 'Commercial & Property Law',
      levelName: '200L',
      termOrSemester: 'First Semester',
      priceKobo: 0,
      isFree: true,
      encryptedFileUrl: 'https://cdn.studentspark.app/samples/nigerian_commercial_law.pdf',
      pageCount: 135,
      format: 'PDF',
      status: MarketplaceItemStatus.APPROVED,
      schoolId: null,
    },
  ];

  for (const m of publicMaterials) {
    const existing = await prisma.marketplaceItem.findFirst({
      where: { title: m.title },
    });
    if (!existing) {
      await prisma.marketplaceItem.create({
        data: {
          ...m,
          sellerId: seller.id,
        },
      });
      console.log(`+ Seeded: ${m.title}`);
    } else {
      console.log(`= Already exists: ${m.title}`);
    }
  }

  console.log('✅ Public Store materials seeding completed!');
}

main().finally(() => prisma.$disconnect());
