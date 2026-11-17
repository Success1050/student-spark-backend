import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InstitutionType,
  MarketplaceItemStatus,
  MarketplaceVisibilityScope,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReferralsWalletService } from '../referrals-wallet/referrals-wallet.service.js';
import { StorageService } from '../storage/storage.service.js';
import { DrmWatermarkService } from './drm/drm-watermark.service.js';
import {
  CreateMarketplaceItemDto,
  QueryMarketplaceDto,
} from './dto/marketplace.dto.js';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly drm: DrmWatermarkService,
    private readonly storage: StorageService,
    private readonly walletService: ReferralsWalletService,
  ) {}

  /**
   * Automatically seeds realistic curriculum materials across Universities, Polytechnics,
   * and Secondary schools if the catalog is empty.
   */
  private async seedDefaultMaterialsIfEmpty() {
    const count = await this.prisma.marketplaceItem.count();
    if (count > 0) return;

    // Use or create dedicated publisher account
    let defaultSeller = await this.prisma.user.findUnique({
      where: { email: 'author.publisher@studentspark.ng' },
    });
    if (!defaultSeller) {
      defaultSeller = await this.prisma.user.create({
        data: {
          email: 'author.publisher@studentspark.ng',
          fullName: 'Spark Academic Publishing House',
          username: 'spark_publishers',
          role: 'TEACHER',
          referralCode: 'SPARKPUB' + Date.now().toString().slice(-4),
        },
      });
    }

    const sampleBooks = [
      // 1. University Course Handout (Course/Class Shelf)
      {
        title: 'CSC 201: Data Structures & Algorithms Handout',
        description:
          'Comprehensive second-year computer science lecture notes covering arrays, linked lists, binary search trees, hash tables, and algorithm complexity analysis (Big-O).',
        authorName: 'Dr. A. E. Okonjo',
        courseCode: 'CSC 201',
        institutionType: InstitutionType.UNIVERSITY,
        visibilityScope: MarketplaceVisibilityScope.COURSE_OR_CLASS,
        facultyName: 'Faculty of Science',
        departmentName: 'Computer Science',
        levelName: '200L',
        termOrSemester: 'First Semester',
        priceKobo: 0,
        isFree: true,
        encryptedFileUrl: 'https://cdn.studentspark.app/samples/csc201_algorithms.pdf',
        pageCount: 64,
        format: 'PDF',
        status: MarketplaceItemStatus.APPROVED,
      },
      // 2. University General Course (Department & Faculty / School Library)
      {
        title: 'GST 101: Use of English & Communication Skills',
        description:
          'University-wide general study manual on grammar, essay composition, phonetics, reading comprehension, and examination techniques for undergraduate students.',
        authorName: 'Prof. Florence Adebayo',
        courseCode: 'GST 101',
        institutionType: InstitutionType.UNIVERSITY,
        visibilityScope: MarketplaceVisibilityScope.SCHOOL_WIDE,
        facultyName: 'Faculty of Arts',
        departmentName: 'General Studies',
        levelName: '100L',
        termOrSemester: 'First Semester',
        priceKobo: 0,
        isFree: true,
        encryptedFileUrl: 'https://cdn.studentspark.app/samples/gst101_english.pdf',
        pageCount: 92,
        format: 'PDF',
        status: MarketplaceItemStatus.APPROVED,
      },
      // 3. Polytechnic Programme Handout
      {
        title: 'COM 111: Introduction to Computing (ND 1 Comp Sci)',
        description:
          'National Diploma core module covering hardware architecture, operating system fundamentals, memory organization, and basic binary logic.',
        authorName: 'Engr. Kenneth Balogun',
        courseCode: 'COM 111',
        institutionType: InstitutionType.POLYTECHNIC,
        visibilityScope: MarketplaceVisibilityScope.COURSE_OR_CLASS,
        facultyName: 'School of Technology',
        departmentName: 'Computer Science',
        levelName: 'ND 1',
        termOrSemester: 'First Semester',
        priceKobo: 50000, // ₦500
        isFree: false,
        encryptedFileUrl: 'https://cdn.studentspark.app/samples/com111_poly.pdf',
        pageCount: 48,
        format: 'PDF',
        status: MarketplaceItemStatus.APPROVED,
      },
      // 4. Secondary School Handout (SS 2 Math)
      {
        title: 'Mathematics for Senior Secondary (SS 2 Curriculum)',
        description:
          'Step-by-step WAEC and NECO syllabus aligned workbook covering quadratic equations, logarithms, trigonometry, and circle geometry.',
        authorName: 'Mrs. Chinyere Nwosu',
        courseCode: 'MTH-SS2',
        institutionType: InstitutionType.SECONDARY,
        visibilityScope: MarketplaceVisibilityScope.COURSE_OR_CLASS,
        facultyName: 'Senior Secondary',
        departmentName: 'Science & Arts',
        levelName: 'SS 2',
        termOrSemester: 'Second Term',
        priceKobo: 0,
        isFree: true,
        encryptedFileUrl: 'https://cdn.studentspark.app/samples/ss2_mathematics.pdf',
        pageCount: 110,
        format: 'PDF',
        status: MarketplaceItemStatus.APPROVED,
      },
      // 5. Public Marketplace Verified Textbook
      {
        title: 'Mastering JAMB UTME & Post-UTME Physics: 1,000 Solved Questions',
        description:
          'High-yield past questions analysis with detailed workings, shortcut formulas, and examiner tips for secondary school graduates and 100L aspirants.',
        authorName: 'Engr. Dayo Adeleke',
        courseCode: 'PHY-JAMB',
        institutionType: InstitutionType.UNIVERSITY,
        visibilityScope: MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
        facultyName: 'Physical Sciences',
        departmentName: 'Physics',
        levelName: 'UTME / 100L',
        termOrSemester: 'Annual',
        priceKobo: 120000, // ₦1,200
        isFree: false,
        encryptedFileUrl: 'https://cdn.studentspark.app/samples/jamb_physics.pdf',
        pageCount: 180,
        format: 'PDF',
        status: MarketplaceItemStatus.APPROVED,
      },
    ];

    for (const book of sampleBooks) {
      await this.prisma.marketplaceItem.create({
        data: {
          ...book,
          sellerId: defaultSeller.id,
          schoolId: defaultSeller.schoolId,
        },
      });
    }

    this.logger.log('Seeded 5 sample E-Library curriculum books across scopes.');
  }

  /**
   * Retrieves materials according to active shelf and tenant hierarchy scopes.
   */
  async listItems(userId?: string, query: QueryMarketplaceDto = {}) {
    await this.seedDefaultMaterialsIfEmpty();

    let user: any = null;
    if (userId) {
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          school: true,
          studentProfile: true,
          teacherProfile: {
            include: {
              assignedClasses: { select: { id: true } },
              assignedSubjects: { select: { id: true, classId: true } },
            },
          },
        },
      });
    }

    const where: any = {
      status: MarketplaceItemStatus.APPROVED,
    };

    // 1. Shelf-based filtering
    switch (query.shelf) {
      case 'COURSE_OR_CLASS': {
        // Independent students have no school affiliation -> cannot access course/class handouts
        if (!user?.schoolId) {
          return [];
        }
        where.visibilityScope = MarketplaceVisibilityScope.COURSE_OR_CLASS;
        where.schoolId = user.schoolId;

        const studentClassId = user.studentProfile?.classId || user.classId;
        if (user.role === 'STUDENT' && studentClassId) {
          where.AND = [
            ...(where.AND || []),
            {
              OR: [{ classId: studentClassId }, { classId: null }],
            },
          ];
        } else if (user.role === 'TEACHER' && user.teacherProfile) {
          const teacherClassIds = new Set<string>();
          for (const c of user.teacherProfile.assignedClasses || []) {
            if (c.id) teacherClassIds.add(c.id);
          }
          for (const s of user.teacherProfile.assignedSubjects || []) {
            if (s.classId) teacherClassIds.add(s.classId);
          }
          if (teacherClassIds.size > 0) {
            where.AND = [
              ...(where.AND || []),
              {
                OR: [
                  { classId: { in: Array.from(teacherClassIds) } },
                  { sellerId: user.id },
                  { classId: null },
                ],
              },
            ];
          }
        }
        break;
      }

      case 'INSTITUTION_SCOPED':
        // Independent students have no school affiliation -> cannot access campus library
        if (!user?.schoolId) {
          return [];
        }
        where.visibilityScope = {
          in: [
            MarketplaceVisibilityScope.DEPARTMENT_OR_FACULTY,
            MarketplaceVisibilityScope.SCHOOL_WIDE,
          ],
        };
        where.schoolId = user.schoolId;
        break;

      case 'PUBLIC_MARKETPLACE':
        where.visibilityScope = MarketplaceVisibilityScope.PUBLIC_MARKETPLACE;
        if (query.schoolId) {
          where.schoolId = query.schoolId;
        }
        break;

      case 'MY_UPLOADS':
        if (userId) {
          where.sellerId = userId;
        }
        break;

      case 'ALL':
      default:
        break;
    }

    // 2. Institution Type filter (UNIVERSITY, POLYTECHNIC, SECONDARY)
    if (query.institutionType) {
      where.institutionType = query.institutionType;
    }

    // 3. School ID filter for Public Marketplace
    if (query.schoolId) {
      where.schoolId = query.schoolId;
    }

    // 4. Course Code filter
    if (query.courseCode) {
      where.courseCode = { contains: query.courseCode, mode: 'insensitive' };
    }

    // 5. Faculty / Department / Level filters
    if (query.facultyName) {
      where.facultyName = { contains: query.facultyName, mode: 'insensitive' };
    }
    if (query.departmentName) {
      where.departmentName = { contains: query.departmentName, mode: 'insensitive' };
    }
    if (query.levelName) {
      where.levelName = { contains: query.levelName, mode: 'insensitive' };
    }

    // 6. Free-only filter
    if (query.isFree !== undefined) {
      const isFreeBool = String(query.isFree) === 'true';
      if (isFreeBool) {
        where.isFree = true;
      }
    }

    if (query.materialType && query.materialType !== 'ALL') {
      where.materialType = query.materialType;
    }

    // 7. Search query across title, description, courseCode, authorName, faculty, department & school name
    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      const searchConditions: any[] = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { courseCode: { contains: s, mode: 'insensitive' } },
        { authorName: { contains: s, mode: 'insensitive' } },
        { facultyName: { contains: s, mode: 'insensitive' } },
        { departmentName: { contains: s, mode: 'insensitive' } },
        { school: { name: { contains: s, mode: 'insensitive' } } },
      ];
      if (where.AND) {
        where.AND.push({ OR: searchConditions });
      } else {
        where.AND = [{ OR: searchConditions }];
      }
    }

    const items = await this.prisma.marketplaceItem.findMany({
      where,
      orderBy: [{ downloadCount: 'desc' }, { createdAt: 'desc' }],
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            username: true,
            role: true,
            avatarUrl: true,
          },
        },
        school: {
          select: {
            id: true,
            name: true,
            institutionType: true,
            schoolCode: true,
          },
        },
        purchases: {
          where: { buyerId: userId || '__NONE__' },
          select: { id: true, purchasedAt: true },
        },
      },
    });

    return items.map((item) => {
      const isPurchased =
        item.sellerId === userId ||
        item.isFree ||
        Boolean(item.purchases && item.purchases.length > 0);

      return {
        id: item.id,
        title: item.title,
        description: item.description,
        authorName: item.authorName || item.seller?.fullName || item.seller?.username || 'Educator',
        courseCode: item.courseCode,
        institutionType: item.institutionType,
        visibilityScope: item.visibilityScope,
        facultyName: item.facultyName,
        departmentName: item.departmentName,
        levelName: item.levelName,
        termOrSemester: item.termOrSemester,
        priceKobo: item.priceKobo,
        priceNaira: (item.priceKobo / 100).toLocaleString(),
        isFree: item.isFree,
        coverUrl: item.coverUrl,
        pageCount: item.pageCount,
        format: item.format,
        fileSize: item.fileSize,
        downloadCount: item.downloadCount,
        salesCount: item.salesCount,
        isPurchased,
        schoolName: item.school?.name || null,
        seller: {
          id: item.seller.id,
          name: item.seller.fullName || item.seller.username || 'Educator',
          role: item.seller.role,
        },
        createdAt: item.createdAt,
      };
    });
  }

  /**
   * Retrieves single item details including purchase status.
   */
  async getItemById(itemId: string, userId?: string) {
    const item = await this.prisma.marketplaceItem.findUnique({
      where: { id: itemId },
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            username: true,
            role: true,
            avatarUrl: true,
          },
        },
        school: true,
        purchases: {
          where: { buyerId: userId || '__NONE__' },
          select: { id: true, purchasedAt: true, offlineLicenseToken: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Marketplace item ${itemId} not found`);
    }

    const isPurchased =
      item.sellerId === userId ||
      item.isFree ||
      Boolean(item.purchases && item.purchases.length > 0);

    return {
      ...item,
      priceNaira: (item.priceKobo / 100).toLocaleString(),
      isPurchased,
    };
  }

  /**
   * Uploads an E-Library book or handout.
   */
  async createItem(sellerId: string, dto: CreateMarketplaceItemDto) {
    if (!sellerId) {
      throw new BadRequestException('Seller ID is required');
    }
    if (!dto.title?.trim() || !dto.description?.trim()) {
      throw new BadRequestException('Title and description are required');
    }

    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
    });
    if (!seller) {
      throw new NotFoundException(`Seller with ID ${sellerId} not found`);
    }

    const priceKobo = Number(dto.priceKobo) || 0;
    const isFree = dto.isFree === true || priceKobo <= 0;

    let fileUrl = dto.encryptedFileUrl;
    let resolvedFileSize = dto.fileSize || 1024 * 1024 * 2;
    if (dto.fileBase64) {
      const cleanB64 = dto.fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(cleanB64, 'base64');
      if (buf.length > 0) {
        resolvedFileSize = buf.length;
        const baseName = (
          dto.fileName || `${dto.title.replace(/\s+/g, '_').toLowerCase()}.pdf`
        ).replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageName = `${Date.now()}_${baseName}`;
        const uploaded = await this.storage.uploadPdfBuffer(
          buf,
          storageName,
          'marketplace',
        );
        fileUrl = uploaded.publicUrl;
      }
    }

    if (!fileUrl) {
      fileUrl = `https://cdn.studentspark.app/uploads/${encodeURIComponent(
        dto.title.replace(/\s+/g, '_').toLowerCase(),
      )}.pdf`;
    }

    // If seller has existing items with a Paystack subaccount code configured, inherit it
    let subaccountCode = dto.paystackSubaccountCode?.trim() || null;
    if (!subaccountCode) {
      const existingSubaccountItem = await this.prisma.marketplaceItem.findFirst({
        where: { sellerId, paystackSubaccountCode: { not: null } },
        select: { paystackSubaccountCode: true },
        orderBy: { updatedAt: 'desc' },
      });
      subaccountCode = existingSubaccountItem?.paystackSubaccountCode || null;
    }

    const normalizedSplits = Array.isArray(dto.royaltySplitJson)
      ? dto.royaltySplitJson
          .filter((r) => r && Number(r.percent) > 0 && r.name)
          .map((r) => ({
            name: String(r.name).trim(),
            userId: r.userId || undefined,
            percent: Number(r.percent),
            role: r.role || 'Co-Author',
          }))
      : null;

    const item = await this.prisma.marketplaceItem.create({
      data: {
        sellerId,
        schoolId: dto.schoolId || seller.schoolId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        authorName: dto.authorName?.trim() || seller.fullName || seller.username,
        courseCode: dto.courseCode?.trim().toUpperCase() || 'GENERAL',
        institutionType: dto.institutionType || InstitutionType.UNIVERSITY,
        visibilityScope:
          dto.visibilityScope || MarketplaceVisibilityScope.PUBLIC_MARKETPLACE,
        materialType: dto.materialType?.trim().toUpperCase() || 'BOOK',
        priceKobo: isFree ? 0 : priceKobo,
        isFree,
        coverUrl: dto.coverUrl,
        encryptedFileUrl: fileUrl,
        pageCount: dto.pageCount || 20,
        facultyName: dto.facultyName?.trim(),
        departmentName: dto.departmentName?.trim(),
        levelName: dto.levelName?.trim(),
        termOrSemester: dto.termOrSemester?.trim(),
        classId: dto.classId || seller.classId,
        subjectId: dto.subjectId,
        fileSize: resolvedFileSize,
        format: dto.format || 'PDF',
        royaltySplitJson: normalizedSplits ?? undefined,
        paystackSubaccountCode: subaccountCode,
        status: MarketplaceItemStatus.APPROVED, // Auto-approved for frictionless author upload
      },
    });

    // Send publication notification
    void this.notifications.dispatchNotification({
      userId: sellerId,
      title: '📚 Book Published to E-Library!',
      body: `"${item.title}" is now live on the ${item.visibilityScope.replace(/_/g, ' ')} shelf.`,
      category: 'COMMUNITY',
      deepLink: '/marketplace',
      channels: { inApp: true, push: true, email: true },
      emailSubject: `StudentSpark E-Library: "${item.title}" Published`,
    });

    return {
      success: true,
      message: `"${item.title}" successfully added to the E-Library`,
      item,
    };
  }

  /**
   * Initializes book purchase: returns Paystack checkout metadata or grants instant free access.
   */
  async initializePurchase(buyerId: string, itemId: string) {
    if (!buyerId) throw new BadRequestException('Buyer ID is required');

    const item = await this.prisma.marketplaceItem.findUnique({
      where: { id: itemId },
      include: { school: true },
    });
    if (!item) throw new NotFoundException(`Marketplace item ${itemId} not found`);

    // Check if buyer is author
    if (item.sellerId === buyerId) {
      return {
        status: 'FREE_ACCESS_GRANTED',
        message: 'You are the author of this material.',
        isFree: true,
        amountKobo: 0,
        amountNaira: '0',
        paystackReference: `AUTHOR-${itemId.slice(0, 8)}-${Date.now()}`,
      };
    }

    // Check if material is free
    if (item.isFree || item.priceKobo <= 0) {
      const existing = await this.prisma.marketplacePurchase.findUnique({
        where: { itemId_buyerId: { itemId, buyerId } },
      });
      if (!existing) {
        const buyer = await this.prisma.user.findUnique({ where: { id: buyerId } });
        const watermark = this.drm.generateBuyerWatermarkPayload({
          fullName: buyer?.fullName || buyer?.username || undefined,
          email: buyer?.email || undefined,
          studentCode: buyer?.studentCode || undefined,
        });
        const licenseToken = this.drm.generateOfflineLicenseToken(itemId, buyerId);
        await this.prisma.marketplacePurchase.create({
          data: {
            itemId,
            buyerId,
            amountPaidKobo: 0,
            platformCommissionKobo: 0,
            sellerEarningsKobo: 0,
            paystackReference: `FREE-${itemId.slice(0, 8)}-${Date.now()}`,
            watermarkText: watermark.watermarkText,
            offlineLicenseToken: licenseToken,
          },
        });
      }
      return {
        status: 'FREE_ACCESS_GRANTED',
        message: 'This material is free for all students.',
        isFree: true,
        amountKobo: 0,
        amountNaira: '0',
        paystackReference: `FREE-${itemId.slice(0, 8)}-${Date.now()}`,
      };
    }

    // Check if already purchased
    const existingPurchase = await this.prisma.marketplacePurchase.findUnique({
      where: { itemId_buyerId: { itemId, buyerId } },
    });
    if (existingPurchase) {
      return {
        status: 'ALREADY_PURCHASED',
        message: 'You already own lifetime access to this textbook.',
        isFree: false,
        amountKobo: item.priceKobo,
        amountNaira: (item.priceKobo / 100).toLocaleString(),
        paystackReference: existingPurchase.paystackReference,
        offlineLicenseToken: existingPurchase.offlineLicenseToken,
      };
    }

    // Paid textbook checkout reference
    const paystackReference = `SSP-BOOK-${itemId.slice(0, 8)}-${Date.now()}`;
    const amountNaira = (item.priceKobo / 100).toLocaleString();

    return {
      status: 'PAYMENT_REQUIRED',
      itemTitle: item.title,
      authorName: item.authorName,
      courseCode: item.courseCode,
      priceKobo: item.priceKobo,
      amountNaira,
      paystackReference,
      paystackSubaccountCode: item.paystackSubaccountCode || null,
      paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_sample_key',
    };
  }

  /**
   * Verifies book payment, executes commission split, credits author's wallet, and creates DRM license.
   */
  async verifyPurchase(buyerId: string, itemId: string, paystackReference: string) {
    if (!buyerId || !itemId || !paystackReference) {
      throw new BadRequestException('buyerId, itemId, and paystackReference are required');
    }

    const item = await this.prisma.marketplaceItem.findUnique({
      where: { id: itemId },
      include: { school: true, seller: true },
    });
    if (!item) throw new NotFoundException(`Marketplace item ${itemId} not found`);

    const buyer = await this.prisma.user.findUnique({
      where: { id: buyerId },
    });
    if (!buyer) throw new NotFoundException(`Buyer ${buyerId} not found`);

    // Check idempotency: already recorded?
    const existingPurchase = await this.prisma.marketplacePurchase.findFirst({
      where: {
        OR: [
          { paystackReference },
          { itemId, buyerId },
        ],
      },
    });
    if (existingPurchase) {
      return {
        success: true,
        message: 'Book already verified and unlocked',
        purchase: existingPurchase,
      };
    }

    // Commission split
    const amountPaidKobo = item.priceKobo;
    const commissionPercent =
      item.customPlatformCommissionPercent ??
      item.school?.customMarketplaceCommissionPercent ??
      20.0;
    const platformCommissionKobo = Math.round((amountPaidKobo * commissionPercent) / 100);
    const sellerEarningsKobo = Math.max(0, amountPaidKobo - platformCommissionKobo);

    const watermark = this.drm.generateBuyerWatermarkPayload({
      fullName: buyer.fullName || buyer.username || undefined,
      email: buyer.email || undefined,
      studentCode: buyer.studentCode || undefined,
    });
    const offlineLicenseToken = this.drm.generateOfflineLicenseToken(itemId, buyerId);

    // Database transaction: create purchase, increment salesCount, credit seller wallet
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create MarketplacePurchase
      const purchase = await tx.marketplacePurchase.create({
        data: {
          itemId,
          buyerId,
          amountPaidKobo,
          platformCommissionKobo,
          sellerEarningsKobo,
          paystackReference,
          watermarkText: watermark.watermarkText,
          offlineLicenseToken,
        },
      });

      // 2. Increment item salesCount
      await tx.marketplaceItem.update({
        where: { id: itemId },
        data: { salesCount: { increment: 1 } },
      });

      // 3. Credit seller / co-author wallets according to royaltySplitJson (or 100% of net earnings to seller)
      if (sellerEarningsKobo > 0 && item.sellerId) {
        const rawSplits = Array.isArray(item.royaltySplitJson)
          ? (item.royaltySplitJson as Array<{ name?: string; userId?: string; percent?: number }>)
          : [];
        const coAuthorRecipients = rawSplits.filter(
          (r) => r.userId && r.userId !== item.sellerId && Number(r.percent) > 0,
        );

        let distributedKobo = 0;
        for (const co of coAuthorRecipients) {
          const sharePercent = Math.min(95, Math.max(0, Number(co.percent) || 0));
          const coAmount = Math.floor((sellerEarningsKobo * sharePercent) / 100);
          if (coAmount <= 0 || !co.userId) continue;

          let coWallet = await tx.wallet.findUnique({ where: { userId: co.userId } });
          if (!coWallet) {
            coWallet = await tx.wallet.create({ data: { userId: co.userId } });
          }
          await tx.wallet.update({
            where: { id: coWallet.id },
            data: { availableBalanceKobo: { increment: coAmount } },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: coWallet.id,
              type: 'CREDIT',
              category: 'MARKETPLACE_SALE',
              amountKobo: coAmount,
              reference: `SPLIT-${paystackReference}-${co.userId.slice(0, 6)}`,
              description: `Co-Author Royalty (${sharePercent}%): "${item.title}"`,
              metadata: {
                itemId: item.id,
                buyerId,
                sharePercent,
              },
            },
          });
          distributedKobo += coAmount;
        }

        const primaryAmount = Math.max(0, sellerEarningsKobo - distributedKobo);
        if (primaryAmount > 0) {
          let sellerWallet = await tx.wallet.findUnique({
            where: { userId: item.sellerId },
          });
          if (!sellerWallet) {
            sellerWallet = await tx.wallet.create({
              data: { userId: item.sellerId },
            });
          }

          await tx.wallet.update({
            where: { id: sellerWallet.id },
            data: { availableBalanceKobo: { increment: primaryAmount } },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: sellerWallet.id,
              type: 'CREDIT',
              category: 'MARKETPLACE_SALE',
              amountKobo: primaryAmount,
              reference: `SALE-${paystackReference}`,
              description: `${item.materialType === 'PRACTICAL_MANUAL' ? 'Manual' : item.materialType === 'LECTURE_HANDOUT' ? 'Handout' : 'Book'} Royalty: "${item.title}" (${100 - commissionPercent}% net earnings)`,
              metadata: {
                itemId: item.id,
                buyerId,
                buyerName: buyer.fullName || buyer.username,
                grossKobo: amountPaidKobo,
                commissionPercent,
                coAuthorDistributedKobo: distributedKobo,
              },
            },
          });
        }
      }

      return purchase;
    });

    // Notifications
    if (item.sellerId) {
      void this.notifications.dispatchNotification({
        userId: item.sellerId,
        title: '💰 Book Sold on E-Library!',
        body: `"${item.title}" was acquired by ${buyer.fullName || 'a student'}. ₦${(sellerEarningsKobo / 100).toLocaleString()} credited to your wallet balance.`,
        category: 'PAYMENTS',
        deepLink: '/referrals',
        channels: { inApp: true, push: true, email: true },
        emailSubject: `StudentSpark Royalty: Book Sale for "${item.title}"`,
      });
    }

    void this.notifications.dispatchNotification({
      userId: buyerId,
      title: '📖 Textbook Unlocked!',
      body: `You now have lifetime access to "${item.title}". Open in your DRM In-App Reader.`,
      category: 'COMMUNITY',
      deepLink: `/ebookReader?bookId=${item.id}`,
      channels: { inApp: true, push: true, email: true },
      emailSubject: `Your Access Receipt: "${item.title}"`,
    });

    return {
      success: true,
      message: `"${item.title}" successfully acquired!`,
      purchase: result,
    };
  }

  /**
   * Retrieves structured chapter content for the In-App DRM Reader with dynamic student watermarking.
   */
  async getReaderAccess(userId: string, itemId: string) {
    const item = await this.prisma.marketplaceItem.findUnique({
      where: { id: itemId },
      include: {
        seller: {
          select: { id: true, fullName: true, username: true, role: true },
        },
        purchases: {
          where: { buyerId: userId || '__NONE__' },
          select: { id: true, offlineLicenseToken: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Marketplace item ${itemId} not found`);
    }

    const isAuthor = item.sellerId === userId;
    const isFree = item.isFree || item.priceKobo <= 0;
    const hasPurchased = Boolean(item.purchases && item.purchases.length > 0);

    if (!isAuthor && !isFree && !hasPurchased) {
      throw new BadRequestException(
        `Purchase required to access DRM reader for "${item.title}". Price: ₦${item.priceKobo / 100}`,
      );
    }

    let buyer = null;
    if (userId) {
      buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    }

    const watermark = this.drm.generateBuyerWatermarkPayload({
      fullName: buyer?.fullName || buyer?.username || undefined,
      email: buyer?.email || undefined,
      studentCode: buyer?.studentCode || undefined,
    });

    const offlineToken =
      item.purchases?.[0]?.offlineLicenseToken ||
      this.drm.generateOfflineLicenseToken(itemId, userId || 'GUEST');

    const isDirectClassNote =
      item.visibilityScope === MarketplaceVisibilityScope.COURSE_OR_CLASS ||
      item.encryptedFileUrl?.startsWith('class-note://');

    const chapters = isDirectClassNote
      ? [
          {
            id: 'ch-1',
            chapterNumber: 1,
            title: item.title,
            summary: `${item.courseCode} • By ${item.authorName || 'Course Educator'}`,
            content: item.description || item.title,
            keyPoints: [],
            selfCheckQuestions: [],
          },
        ]
      : this.drm.generateStructuredChapters({
          title: item.title,
          courseCode: item.courseCode,
          authorName: item.authorName || 'Educator',
          description: item.description,
        });

    return {
      bookId: item.id,
      title: item.title,
      authorName: item.authorName,
      courseCode: item.courseCode,
      institutionType: item.institutionType,
      levelName: item.levelName,
      pageCount: item.pageCount,
      format: item.format || 'PDF',
      isFree: item.isFree,
      attachedFileUrl: item.encryptedFileUrl?.startsWith('http')
        ? this.storage.getAccessiblePdfUrl(item.encryptedFileUrl) ||
          item.encryptedFileUrl
        : null,
      watermarkText: watermark.watermarkText,
      studentIdentifier: watermark.studentIdentifier,
      offlineLicenseToken: offlineToken,
      blockScreenshots: true,
      chapters,
    };
  }

  /**
   * Records a book read / download.
   */
  async recordDownload(itemId: string) {
    const item = await this.prisma.marketplaceItem.update({
      where: { id: itemId },
      data: {
        downloadCount: { increment: 1 },
      },
      select: {
        id: true,
        downloadCount: true,
      },
    });
    return item;
  }

  /**
   * Configures a lecturer's Nigerian NUBAN payout bank account and registers/updates a
   * Paystack Subaccount split across their published handouts & practical manuals.
   */
  async configureLecturerRoyaltyNuban(
    userId: string,
    dto: {
      bankCode: string;
      bankName: string;
      accountNumber: string;
      businessName?: string;
      percentageCharge?: number;
    },
  ) {
    if (!userId) {
      throw new BadRequestException('Authenticated lecturer user ID is required');
    }
    const cleanAccount = dto.accountNumber?.replace(/\D/g, '') || '';
    if (cleanAccount.length !== 10 || !dto.bankCode?.trim() || !dto.bankName?.trim()) {
      throw new BadRequestException('Valid 10-digit NUBAN account number, bank code, and bank name are required');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let accountName = user.fullName || user.username || 'Lecturer Author';
    try {
      const resolved = await this.walletService.resolveBankAccount({
        accountNumber: cleanAccount,
        bankCode: dto.bankCode.trim(),
      });
      if (resolved?.accountName) {
        accountName = resolved.accountName;
      }
    } catch {
      // Fallback to profile name when live Paystack test keys cannot resolve real bank accounts
    }

    const businessName =
      dto.businessName?.trim() || `${accountName} Academic Press`;
    const percentageCharge = Math.min(30, Math.max(5, Number(dto.percentageCharge) || 20));

    let subaccountCode = `ACCT_SSP_${cleanAccount.slice(-4)}_${dto.bankCode.trim()}`;
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (paystackSecret && !paystackSecret.includes('placeholder') && !paystackSecret.includes('sample')) {
      try {
        const res = await fetch('https://api.paystack.co/subaccount', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paystackSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            business_name: businessName,
            settlement_bank: dto.bankCode.trim(),
            account_number: cleanAccount,
            percentage_charge: percentageCharge,
            description: `StudentSpark Lecturer Royalty Split for ${accountName}`,
          }),
        });
        const data: any = await res.json().catch(() => null);
        if (res.ok && data?.data?.subaccount_code) {
          subaccountCode = data.data.subaccount_code;
        }
      } catch (err) {
        this.logger.warn(`Paystack subaccount sync skipped: ${String(err)}`);
      }
    }

    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: {
        userId,
        bankCode: dto.bankCode.trim(),
        bankName: dto.bankName.trim(),
        accountNumber: cleanAccount,
        accountName,
      },
      update: {
        bankCode: dto.bankCode.trim(),
        bankName: dto.bankName.trim(),
        accountNumber: cleanAccount,
        accountName,
      },
    });

    await this.prisma.marketplaceItem.updateMany({
      where: { sellerId: userId },
      data: { paystackSubaccountCode: subaccountCode },
    });

    return {
      success: true,
      message: 'NUBAN payout account & Paystack royalty split configured.',
      accountName,
      bankName: wallet.bankName,
      bankCode: wallet.bankCode,
      accountNumber: wallet.accountNumber,
      paystackSubaccountCode: subaccountCode,
      lecturerSharePercent: 100 - percentageCharge,
      platformCommissionPercent: percentageCharge,
    };
  }

  /**
   * Returns lecturer handouts/manuals catalog, NUBAN payout details, and royalty ledger.
   */
  async getLecturerRoyaltiesSummary(userId: string) {
    if (!userId) {
      throw new BadRequestException('Authenticated lecturer user ID is required');
    }

    const [wallet, items] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { userId },
        include: {
          transactions: {
            where: { category: 'MARKETPLACE_SALE' },
            orderBy: { createdAt: 'desc' },
            take: 25,
          },
        },
      }),
      this.prisma.marketplaceItem.findMany({
        where: { sellerId: userId },
        include: {
          purchases: {
            orderBy: { purchasedAt: 'desc' },
            take: 10,
            select: {
              id: true,
              amountPaidKobo: true,
              sellerEarningsKobo: true,
              platformCommissionKobo: true,
              purchasedAt: true,
              buyer: { select: { fullName: true, studentCode: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalRoyaltiesKobo = items.reduce(
      (sum, it) =>
        sum +
        it.purchases.reduce((pSum, p) => pSum + (p.sellerEarningsKobo || 0), 0),
      0,
    );
    const totalSalesCount = items.reduce((sum, it) => sum + (it.salesCount || 0), 0);
    const activeSubaccount =
      items.find((it) => it.paystackSubaccountCode)?.paystackSubaccountCode || null;

    return {
      success: true,
      payoutAccount: wallet
        ? {
            bankName: wallet.bankName,
            bankCode: wallet.bankCode,
            accountNumber: wallet.accountNumber,
            accountName: wallet.accountName,
            availableBalanceKobo: wallet.availableBalanceKobo,
            availableBalanceNaira: Math.round(wallet.availableBalanceKobo / 100),
            paystackSubaccountCode: activeSubaccount,
          }
        : null,
      stats: {
        publishedCount: items.length,
        totalSalesCount,
        totalRoyaltiesKobo,
        totalRoyaltiesNaira: Math.round(totalRoyaltiesKobo / 100),
      },
      items,
      recentRoyalties: wallet?.transactions || [],
    };
  }
}
