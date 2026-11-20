import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const COMMON_PASSWORD = 'SparkPass2026!';

async function seedDay16() {
  console.log('🌱 Starting Day 16 Enterprise Institution Finance & Bursary Seed...');
  const passwordHash = await bcrypt.hash(COMMON_PASSWORD, 10);

  // 1. Find FUTO School
  const school = await prisma.school.findFirst({
    where: {
      OR: [
        { name: { contains: 'Federal University of Technology, Owerri', mode: 'insensitive' } },
        { schoolCode: 'FUTO' },
      ],
    },
    include: {
      academicUnits: true,
      departments: true,
    },
  });

  if (!school) {
    throw new Error('FUTO school not found in database. Please run prior seeds.');
  }

  console.log(`🏛️ Found School: ${school.name} (${school.schoolCode})`);

  // 2. Provision Bursar User (SCHOOL_FINANCE)
  const bursarEmail = 'bursar@futo.studentspark.ng';
  let bursar = await prisma.user.findUnique({ where: { email: bursarEmail } });
  if (!bursar) {
    bursar = await prisma.user.create({
      data: {
        email: bursarEmail,
        fullName: 'Chief Mrs. Patricia Okoro (Bursar)',
        role: 'SCHOOL_FINANCE',
        loginId: 'BUR-FUTO-001',
        schoolId: school.id,
        passwordHash,
        mustChangePassword: false,
        avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&fit=crop&q=80',
        referralCode: 'REF-BURSAR-001',
      },
    });
  } else {
    bursar = await prisma.user.update({
      where: { id: bursar.id },
      data: {
        fullName: 'Chief Mrs. Patricia Okoro (Bursar)',
        role: 'SCHOOL_FINANCE',
        schoolId: school.id,
        passwordHash,
        mustChangePassword: false,
      },
    });
  }

  const bursarMembership = await prisma.membership.findFirst({
    where: { userId: bursar.id, schoolId: school.id },
  });
  if (!bursarMembership) {
    await prisma.membership.create({
      data: {
        userId: bursar.id,
        schoolId: school.id,
        role: 'SCHOOL_FINANCE',
        status: 'ACTIVE',
      },
    });
  }

  console.log(`💼 Seeded Bursar Account: ${bursar.email} (Password: ${COMMON_PASSWORD})`);

  // 3. Find Academic Units & Departments
  const seetUnit = school.academicUnits.find((u) => u.code.includes('SEET') || u.name.includes('Engineering'));
  const eeeDept = school.departments.find((d) => d.code.includes('EEE') || d.name.includes('Electrical'));

  // 4. Create Payment Accounts
  let centralAccount = await prisma.paymentAccount.findFirst({
    where: { schoolId: school.id, accountNumber: '0123456789' },
  });
  if (!centralAccount) {
    centralAccount = await prisma.paymentAccount.create({
      data: {
        schoolId: school.id,
        accountName: 'Federal University of Technology Owerri - Main Revenue',
        accountNumber: '0123456789',
        bankName: 'First Bank of Nigeria',
        bankCode: '011',
        accountType: 'CENTRAL_BURSARY',
        isDefault: true,
        description: 'Primary institution treasury collection account for tuition and mandatory levies.',
        paystackSubaccountCode: null,
      },
    });
  }

  let facultyAccount = await prisma.paymentAccount.findFirst({
    where: { schoolId: school.id, accountNumber: '1029384756' },
  });
  if (!facultyAccount) {
    facultyAccount = await prisma.paymentAccount.create({
      data: {
        schoolId: school.id,
        accountName: 'SEET Engineering Faculty Development Fund',
        accountNumber: '1029384756',
        bankName: 'Zenith Bank',
        bankCode: '057',
        accountType: 'FACULTY_ACCOUNT',
        unitId: seetUnit?.id,
        isDefault: false,
        description: 'Dedicated account for Engineering workshop levies and laboratory equipment.',
      },
    });
  }

  let deptAccount = await prisma.paymentAccount.findFirst({
    where: { schoolId: school.id, accountNumber: '2233445566' },
  });
  if (!deptAccount) {
    deptAccount = await prisma.paymentAccount.create({
      data: {
        schoolId: school.id,
        accountName: 'FUTO Electrical & Electronic Engineering Dept Association',
        accountNumber: '2233445566',
        bankName: 'GTBank',
        bankCode: '058',
        accountType: 'DEPARTMENTAL_ACCOUNT',
        departmentId: eeeDept?.id,
        isDefault: false,
        description: 'Departmental dues, IEEE student branch dues, and technical excursion fees.',
      },
    });
  }

  console.log('🏦 Seeded 3 Multi-Tier Bank Accounts (Central, Faculty, Departmental)');

  // 5. Create Fee Structures
  // Structure A: Central Tuition (Whole School, ₦85,000)
  let tuitionFee = await prisma.feeStructure.findFirst({
    where: { schoolId: school.id, code: 'FUTO-TUI-2025-2026' },
  });
  if (!tuitionFee) {
    tuitionFee = await prisma.feeStructure.create({
      data: {
        schoolId: school.id,
        title: '2025/2026 Undergraduate Tuition & Development Levy',
        code: 'FUTO-TUI-2025-2026',
        sessionName: '2025/2026',
        termOrSemester: 'First Semester',
        targetScope: 'WHOLE_SCHOOL',
        paymentAccountId: centralAccount.id,
        dueDate: new Date('2026-12-31'),
        isMandatory: true,
        allowPartialPayment: true,
        minimumPartialKobo: 2500000, // ₦25,000 minimum partial
        totalAmountKobo: 8500000, // ₦85,000
        createdById: bursar.id,
        feeItems: {
          create: [
            { name: 'Undergraduate Tuition Fee', amountKobo: 5000000, sortOrder: 1 },
            { name: 'ICT & Smart Campus Portal Access', amountKobo: 1500000, sortOrder: 2 },
            { name: 'University Medical & Health Insurance', amountKobo: 1000000, sortOrder: 3 },
            { name: 'Digital & Physical E-Library Access', amountKobo: 1000000, sortOrder: 4 },
          ],
        },
      },
    });
  }

  // Structure B: Engineering Workshop & Lab Levy (Faculty Scoped, ₦25,000)
  let labFee = await prisma.feeStructure.findFirst({
    where: { schoolId: school.id, code: 'SEET-LAB-2025-2026' },
  });
  if (!labFee) {
    labFee = await prisma.feeStructure.create({
      data: {
        schoolId: school.id,
        title: '2025/2026 Engineering Workshop & Practicals Levy',
        code: 'SEET-LAB-2025-2026',
        sessionName: '2025/2026',
        termOrSemester: 'First Semester',
        targetScope: 'FACULTY',
        unitId: seetUnit?.id,
        paymentAccountId: facultyAccount.id,
        dueDate: new Date('2026-12-15'),
        isMandatory: true,
        allowPartialPayment: false,
        totalAmountKobo: 2500000, // ₦25,000
        createdById: bursar.id,
        feeItems: {
          create: [
            { name: 'Mechanical & Electrical Machines Workshop', amountKobo: 1500000, sortOrder: 1 },
            { name: 'Circuit Design & Lab Consumables', amountKobo: 1000000, sortOrder: 2 },
          ],
        },
      },
    });
  }

  // Structure C: EEE Departmental Dues (Department Scoped, ₦10,000)
  let deptFee = await prisma.feeStructure.findFirst({
    where: { schoolId: school.id, code: 'EEE-DUES-2025-2026' },
  });
  if (!deptFee) {
    deptFee = await prisma.feeStructure.create({
      data: {
        schoolId: school.id,
        title: '2025/2026 EEE Departmental Association Dues',
        code: 'EEE-DUES-2025-2026',
        sessionName: '2025/2026',
        termOrSemester: 'First Semester',
        targetScope: 'DEPARTMENT',
        departmentId: eeeDept?.id,
        paymentAccountId: deptAccount.id,
        dueDate: new Date('2026-11-30'),
        isMandatory: true,
        allowPartialPayment: false,
        totalAmountKobo: 1000000, // ₦10,000
        createdById: bursar.id,
        feeItems: {
          create: [
            { name: 'Annual Departmental Membership Dues', amountKobo: 700000, sortOrder: 1 },
            { name: 'IEEE & Nigerian Society of Engineers Student Chapter', amountKobo: 300000, sortOrder: 2 },
          ],
        },
      },
    });
  }

  console.log('📋 Seeded 3 Scoped Fee Structures (Whole School, Faculty, Department)');

  // 6. Seed Invoices for Test Student: Ngozi Eze (`student.voter@futo.studentspark.ng`)
  const student = await prisma.user.findFirst({
    where: {
      schoolId: school.id,
      email: 'student.voter@futo.studentspark.ng',
    },
    include: { studentProfile: true },
  });

  if (student) {
    console.log(`👨‍🎓 Generating Invoices and test payments for Student: ${student.fullName} (${student.email})`);

    // Invoice 1: Tuition Invoice (Partially Paid with Cash, Balance ₦35,000)
    let invTuition = await prisma.studentInvoice.findFirst({
      where: { studentId: student.id, feeStructureId: tuitionFee.id },
    });
    if (!invTuition) {
      invTuition = await prisma.studentInvoice.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          feeStructureId: tuitionFee.id,
          invoiceNumber: 'INV-FUTO-2026-0001-TUITION',
          totalAmountKobo: 8500000,
          paidAmountKobo: 5000000, // ₦50,000 paid
          balanceAmountKobo: 3500000, // ₦35,000 balance
          status: 'PARTIALLY_PAID',
          qrClearanceToken: 'CLR-FUTO-TUI-0001',
        },
      });

      // Record Cash payment made at Bursary
      const pay1 = await prisma.financePayment.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          invoiceId: invTuition.id,
          paymentAccountId: centralAccount.id,
          amountKobo: 5000000,
          channel: 'CASH',
          status: 'VERIFIED',
          reference: 'CSH-1794762-001',
          recordedById: bursar.id,
          verifiedById: bursar.id,
          verifiedAt: new Date(),
          receiptNumber: 'REC-FUTO-2026-0012',
          qrReceiptToken: 'RCV-FUTO-TUI-PARTIAL-0012',
          metadataJson: { notes: 'Paid ₦50,000 Cash at Senate Bursary Counter' },
        },
      });

      await prisma.financeReceipt.create({
        data: {
          schoolId: school.id,
          paymentId: pay1.id,
          invoiceId: invTuition.id,
          studentId: student.id,
          receiptNumber: 'REC-FUTO-2026-0012',
          qrToken: 'RCV-FUTO-TUI-PARTIAL-0012',
          amountKobo: 5000000,
          payerFullName: student.fullName || 'Ngozi Eze',
          payerMatricOrAdmissionNo: student.studentProfile?.matricOrAdmissionNo || student.loginId,
          academicSession: '2025/2026',
          feeCategory: 'Undergraduate Tuition & Development Levy (1st Installment)',
        },
      });
    }

    // Invoice 2: Engineering Workshop & Lab Levy (₦25,000 with PENDING Bank Transfer Proof uploaded for Bursar Review!)
    let invLab = await prisma.studentInvoice.findFirst({
      where: { studentId: student.id, feeStructureId: labFee.id },
    });
    if (!invLab) {
      invLab = await prisma.studentInvoice.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          feeStructureId: labFee.id,
          invoiceNumber: 'INV-FUTO-2026-0002-LAB',
          totalAmountKobo: 2500000,
          paidAmountKobo: 0,
          balanceAmountKobo: 2500000,
          status: 'UNPAID',
          qrClearanceToken: 'CLR-FUTO-LAB-0002',
        },
      });

      // Submit Pending Bank Transfer Evidence
      await prisma.paymentEvidence.create({
        data: {
          invoiceId: invLab.id,
          studentId: student.id,
          payerName: 'Eze Ngozi Nnamdi',
          payerBankName: 'Access Bank Plc',
          transferAmountKobo: 2500000,
          proofImageUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&fit=crop&q=80',
          submissionNotes: 'Paid via Access Bank Mobile App to Zenith Bank SEET Faculty Account.',
          status: 'PENDING',
        },
      });
      console.log('📸 Seeded PENDING Bank Transfer Proof for Bursar Review queue!');
    }

    // Invoice 3: Departmental Dues (₦10,000 - Fully Paid via POS with Verified Digital Receipt!)
    let invDept = await prisma.studentInvoice.findFirst({
      where: { studentId: student.id, feeStructureId: deptFee.id },
    });
    if (!invDept) {
      invDept = await prisma.studentInvoice.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          feeStructureId: deptFee.id,
          invoiceNumber: 'INV-FUTO-2026-0003-EEE',
          totalAmountKobo: 1000000,
          paidAmountKobo: 1000000,
          balanceAmountKobo: 0,
          status: 'PAID',
          clearedAt: new Date(),
          qrClearanceToken: 'CLR-FUTO-EEE-CLEARED-0003',
        },
      });

      const pay3 = await prisma.financePayment.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          invoiceId: invDept.id,
          paymentAccountId: deptAccount.id,
          amountKobo: 1000000,
          channel: 'POS',
          status: 'VERIFIED',
          reference: 'POS-1794762-003',
          posTerminalRef: 'POS-STANBIC-9921',
          recordedById: bursar.id,
          verifiedById: bursar.id,
          verifiedAt: new Date(),
          receiptNumber: 'REC-FUTO-2026-0099',
          qrReceiptToken: 'RCV-FUTO-EEE-FINAL-0099',
          metadataJson: { notes: 'Paid via POS at Departmental Office' },
        },
      });

      await prisma.financeReceipt.create({
        data: {
          schoolId: school.id,
          paymentId: pay3.id,
          invoiceId: invDept.id,
          studentId: student.id,
          receiptNumber: 'REC-FUTO-2026-0099',
          qrToken: 'RCV-FUTO-EEE-FINAL-0099',
          amountKobo: 1000000,
          payerFullName: student.fullName || 'Ngozi Eze',
          payerMatricOrAdmissionNo: student.studentProfile?.matricOrAdmissionNo || student.loginId,
          academicSession: '2025/2026',
          feeCategory: '2025/2026 EEE Departmental Association Dues',
        },
      });
    }

    console.log('✅ Seeded Invoices: 1 Tuition (Partial), 1 Lab (Pending Proof), 1 Dept Dues (Cleared with QR Receipt)');
  }

  console.log('🎉 Day 16 Enterprise Institution Finance Seed Complete!');
}

seedDay16()
  .catch((e) => {
    console.error('❌ Day 16 Seed Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
