import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SugGateway } from './sug.gateway.js';

export type SugTier = 'SUG_CENTRAL' | 'FACULTY' | 'DEPARTMENT' | 'COURSE_REP';

@Injectable()
export class SugService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly gateway: SugGateway,
  ) {}

  private isTertiaryType(institutionType?: string | null): boolean {
    return (
      institutionType === 'UNIVERSITY' ||
      institutionType === 'POLYTECHNIC' ||
      institutionType === 'COLLEGE_OF_EDUCATION' ||
      institutionType === 'TECHNICAL'
    );
  }

  private async resolveActor(userId: string, explicitSchoolId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        school: true,
        studentProfile: {
          include: {
            department: { include: { unit: true } },
            schoolClass: true,
          },
        },
        teacherProfile: {
          include: {
            department: { include: { unit: true } },
          },
        },
        memberships: {
          where: explicitSchoolId ? { schoolId: explicitSchoolId } : undefined,
        },
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    const ownSchoolId =
      user.schoolId ||
      user.studentProfile?.schoolId ||
      user.teacherProfile?.schoolId ||
      user.memberships?.[0]?.schoolId;

    if (
      user.role !== 'SUPER_ADMIN' &&
      explicitSchoolId &&
      ownSchoolId &&
      explicitSchoolId !== ownSchoolId
    ) {
      throw new ForbiddenException(
        'Cross-tenant access denied: You cannot access another institution.',
      );
    }

    const schoolId =
      user.role === 'SUPER_ADMIN' ? explicitSchoolId || ownSchoolId : ownSchoolId;

    if (!schoolId) {
      throw new ForbiddenException(
        'SUG Governance is available to users enrolled in a tertiary institution.',
      );
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        institutionType: true,
        academicContinuityMode: true,
      },
    });
    if (!school) throw new NotFoundException('Institution not found.');

    const membership = user.memberships?.find((m) => m.schoolId === schoolId);
    const effectiveRole = String(membership?.role || user.role).toUpperCase();

    const activeOffices = await this.prisma.sugOfficeHolder.findMany({
      where: { userId, schoolId, isActive: true },
      include: {
        role: true,
        unit: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
      },
    });

    const isSchoolAdmin =
      effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'SUPER_ADMIN';
    const isLecturer = effectiveRole === 'TEACHER';
    const isStudent = effectiveRole === 'STUDENT';
    const isExecutive = activeOffices.length > 0;

    const permissions = {
      isSchoolAdmin,
      isLecturer,
      isStudent,
      isExecutive,
      canManageRolesAndElections:
        isSchoolAdmin || activeOffices.some((o) => o.role.canManageElections),
      // SUG Presidents & Executives see school/SUG finance strictly READ-ONLY
      canViewFinanceReadOnly:
        isSchoolAdmin ||
        effectiveRole === 'SCHOOL_FINANCE' ||
        activeOffices.some((o) => o.role.canViewFinanceReadOnly),
      canEditFinance: false, // Explicitly read-only for SUG portal
      canPostPublicUpdates:
        isSchoolAdmin ||
        activeOffices.some((o) => o.role.canPostPublicUpdates),
      canPostOpportunities:
        isSchoolAdmin ||
        activeOffices.some((o) => o.role.canPostOpportunities),
      canManageWelfare:
        isSchoolAdmin || activeOffices.some((o) => o.role.canManageWelfare),
      canPostInternal:
        isSchoolAdmin || activeOffices.some((o) => o.role.canPostInternal),
      canViewInternal: isSchoolAdmin || isExecutive,
      canVote: isStudent,
      canViewElections: true,
      canSubmitWelfare: isStudent || isExecutive,
      canChatLeaders: true,
    };

    return {
      user,
      school,
      schoolId,
      effectiveRole,
      activeOffices,
      permissions,
    };
  }

  private async ensureDefaultRoles(schoolId: string) {
    const existingCount = await this.prisma.sugRoleConfig.count({
      where: { schoolId },
    });
    if (existingCount > 0) return;

    const defaults = [
      {
        title: 'SUG President',
        tier: 'SUG_CENTRAL',
        description:
          'Chief Executive of the Student Union Government; leads union advocacy, oversees executives, and views finance read-only.',
        dueForElection: true,
        canViewFinanceReadOnly: true,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: true,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 1,
        sortOrder: 1,
      },
      {
        title: 'SUG Vice President',
        tier: 'SUG_CENTRAL',
        description:
          'Assists the SUG President on campus coordination, academic liaison, and committee oversight.',
        dueForElection: false,
        canViewFinanceReadOnly: true,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: true,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 1,
        sortOrder: 2,
      },
      {
        title: 'SUG Financial Secretary',
        tier: 'SUG_CENTRAL',
        description:
          'Reviews union dues, budget transparency reports, and expenditure summaries (Read-Only audit access).',
        dueForElection: false,
        canViewFinanceReadOnly: true,
        canPostPublicUpdates: true,
        canPostOpportunities: false,
        canManageWelfare: false,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 1,
        sortOrder: 3,
      },
      {
        title: 'SUG Welfare & Bursary Director',
        tier: 'SUG_CENTRAL',
        description:
          'Manages hostel power/water grievances, indigent bursaries, and transport welfare tickets.',
        dueForElection: false,
        canViewFinanceReadOnly: false,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: true,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 1,
        sortOrder: 4,
      },
      {
        title: 'SUG Academic & PRO Director',
        tier: 'SUG_CENTRAL',
        description:
          'Publishes campus bulletins, scholarships, internship vacancies, and Students’ Week notices.',
        dueForElection: false,
        canViewFinanceReadOnly: false,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: false,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 1,
        sortOrder: 5,
      },
      {
        title: 'Faculty President',
        tier: 'FACULTY',
        description:
          'Leads a Faculty Student Association (e.g., NUESA / NACOSS / LAWSA Faculty Chapter).',
        dueForElection: false,
        canViewFinanceReadOnly: true,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: true,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 10,
        sortOrder: 6,
      },
      {
        title: 'Departmental President',
        tier: 'DEPARTMENT',
        description:
          'Heads a Departmental Association and coordinates with HODs, lecturers, and course reps.',
        dueForElection: false,
        canViewFinanceReadOnly: false,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: true,
        canManageElections: false,
        canPostInternal: true,
        maxHolders: 30,
        sortOrder: 7,
      },
      {
        title: 'Course Representative',
        tier: 'COURSE_REP',
        description:
          'Level/course liaison coordinating lecture venues, slides, and peer feedback.',
        dueForElection: false,
        canViewFinanceReadOnly: false,
        canPostPublicUpdates: true,
        canPostOpportunities: false,
        canManageWelfare: false,
        canManageElections: false,
        canPostInternal: false,
        maxHolders: 100,
        sortOrder: 8,
      },
    ];

    await this.prisma.sugRoleConfig.createMany({
      data: defaults.map((d) => ({ ...d, schoolId })),
    });
  }

  private async resolveCandidatePhoto(
    photoBase64?: string,
    photoUrl?: string,
  ): Promise<string | null> {
    if (photoBase64?.trim()) {
      const clean = photoBase64.includes('base64,')
        ? photoBase64.split('base64,')[1]
        : photoBase64;
      const buf = Buffer.from(clean, 'base64');
      if (buf.byteLength > 0) {
        const up = await this.storage.uploadImageBuffer(
          buf,
          `cand_${randomUUID().slice(0, 10)}.jpg`,
          'sug-candidates',
        );
        return up.publicUrl;
      }
    }
    return photoUrl?.trim() || null;
  }

  async getOverview(userId: string, explicitSchoolId?: string) {
    const actor = await this.resolveActor(userId, explicitSchoolId);
    const { schoolId, school, permissions, activeOffices } = actor;

    if (!this.isTertiaryType(school.institutionType)) {
      return {
        isTertiary: false,
        school,
        permissions,
        actorContext: null,
        myOffices: [],
        roles: [],
        executives: [],
        elections: [],
        endorsementCalls: [],
        eligiblePeers: [],
        publicPosts: [],
        internalPosts: [],
        welfareTickets: [],
        financeSummary: null,
        hierarchy: { faculties: [], departments: [], classes: [] },
      };
    }

    await this.ensureDefaultRoles(schoolId);

    const normalizeLvl = (raw?: string | null): string => {
      const m = String(raw || '').match(/(100|200|300|400|500|600|ND\s*[12]|HND\s*[12])/i);
      if (m) return m[1].replace(/\s+/g, '').toUpperCase().replace(/^(\d{3})$/, '$1L');
      return String(raw || '').trim().toUpperCase();
    };
    const studentLevelCode = normalizeLvl(
      actor.user.studentProfile?.level || actor.user.studentProfile?.schoolClass?.levelCode || actor.user.studentProfile?.schoolClass?.name,
    );
    const studentDepartmentId = actor.user.studentProfile?.departmentId || null;
    const studentUnitId = actor.user.studentProfile?.department?.unitId || null;

    const [
      roles,
      holders,
      courseReps,
      elections,
      posts,
      tickets,
      faculties,
      departments,
      classes,
      feeItems,
      feePayments,
      allNominees,
      myEndorsementVotes,
      campusStudents,
    ] = await Promise.all([
      this.prisma.sugRoleConfig.findMany({
        where: { schoolId, isActive: true },
        include: {
          unit: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.sugOfficeHolder.findMany({
        where: { schoolId, isActive: true },
        include: {
          role: true,
          unit: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true, code: true } },
          schoolClass: { select: { id: true, name: true } },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
              studentProfile: {
                select: {
                  level: true,
                  matricOrAdmissionNo: true,
                  department: {
                    select: { name: true, unit: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ role: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
      }),
      this.prisma.courseRepAssignment.findMany({
        where: { schoolId, isActive: true },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              studentProfile: {
                select: { level: true, matricOrAdmissionNo: true },
              },
            },
          },
          department: { select: { id: true, name: true, code: true } },
          schoolClass: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true, courseCode: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sugElection.findMany({
        where: { schoolId },
        include: {
          role: { select: { id: true, title: true, tier: true } },
          unit: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true, code: true } },
          candidates: {
            where: { isApproved: true },
            orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }],
          },
          votes: {
            where: { voterId: userId },
            select: { candidateId: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.sugPost.findMany({
        where: permissions.canViewInternal
          ? { schoolId }
          : { schoolId, isInternalOnly: false },
        include: {
          author: { select: { id: true, fullName: true, avatarUrl: true } },
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 60,
      }),
      this.prisma.sugWelfareTicket.findMany({
        where:
          permissions.isSchoolAdmin || permissions.canManageWelfare
            ? { schoolId }
            : permissions.isLecturer
            ? { schoolId, isPublicSummary: true }
            : {
                schoolId,
                OR: [{ reporterId: userId }, { isPublicSummary: true, status: 'RESOLVED' }],
              },
        include: {
          reporter: {
            select: {
              id: true,
              fullName: true,
              studentProfile: { select: { level: true, department: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      this.prisma.academicUnit.findMany({
        where: { schoolId },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { schoolId },
        select: { id: true, name: true, code: true, unitId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        select: { id: true, name: true, levelCode: true, departmentId: true },
        orderBy: { name: 'asc' },
      }),
      permissions.canViewFinanceReadOnly
        ? this.prisma.schoolFeeItem.findMany({
            where: { schoolId },
            orderBy: { createdAt: 'desc' },
            take: 25,
          })
        : Promise.resolve([]),
      permissions.canViewFinanceReadOnly
        ? this.prisma.schoolFeePayment.findMany({
            where: { feeItem: { schoolId } },
            include: {
              feeItem: { select: { title: true } },
              student: { select: { fullName: true } },
            },
            orderBy: { paidAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
      this.prisma.sugEndorsementNominee.findMany({
        where: { schoolId },
        orderBy: [{ endorsementCount: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.sugEndorsementVote.findMany({
        where: { voterId: userId, role: { schoolId } },
        select: { roleId: true, nomineeId: true },
      }),
      this.prisma.user.findMany({
        where: {
          role: 'STUDENT',
          OR: [
            { schoolId },
            { studentProfile: { schoolId } },
            { memberships: { some: { schoolId, role: 'STUDENT' } } },
          ],
        },
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          studentProfile: {
            select: {
              level: true,
              departmentId: true,
              department: {
                select: {
                  id: true,
                  name: true,
                  unitId: true,
                  unit: { select: { id: true, name: true } },
                },
              },
              schoolClass: { select: { levelCode: true, name: true } },
            },
          },
        },
        orderBy: { fullName: 'asc' },
        take: 200,
      }),
    ]);

    const executives = [
      ...holders.map((h) => ({
        id: h.id,
        holderId: h.id,
        userId: h.userId,
        fullName: h.user.fullName,
        avatarUrl: h.photoUrl || h.user.avatarUrl || null,
        roleTitle: h.role.title,
        tier: h.role.tier as SugTier,
        facultyName:
          h.unit?.name ||
          h.user.studentProfile?.department?.unit?.name ||
          null,
        departmentName:
          h.department?.name ||
          h.user.studentProfile?.department?.name ||
          null,
        level: h.user.studentProfile?.level || h.schoolClass?.name || null,
        tenureLabel: h.tenureLabel,
        manifestoOrBio: h.manifestoOrBio,
        isCourseRep: false,
      })),
      ...courseReps.map((cr) => ({
        id: `cr_${cr.id}`,
        holderId: null,
        userId: cr.studentId,
        fullName: cr.student.fullName,
        avatarUrl: cr.student.avatarUrl || null,
        roleTitle: `${cr.title}${cr.subject?.courseCode ? ` (${cr.subject.courseCode})` : ''}`,
        tier: 'COURSE_REP' as SugTier,
        facultyName: null,
        departmentName: cr.department?.name || null,
        level: cr.schoolClass?.name || cr.student.studentProfile?.level || null,
        tenureLabel: 'Active',
        manifestoOrBio: cr.subject
          ? `Course Rep for ${cr.subject.courseCode} • ${cr.subject.name}`
          : 'Level Course Representative',
        isCourseRep: true,
      })),
    ];

    const statusOrder: Record<string, number> = { LIVE: 0, UPCOMING: 1, CLOSED: 2 };
    const formattedElections = elections
      .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))
      .map((el) => {
        const totalVotes = el.candidates.reduce((sum, c) => sum + c.voteCount, 0);
        const topVotes = el.candidates[0]?.voteCount ?? 0;
        const myVotedCandidateId = el.votes[0]?.candidateId || null;

        return {
          id: el.id,
          title: el.title,
          description: el.description,
          roleId: el.roleId,
          roleTitle: el.role.title,
          scopeTier: el.scopeTier,
          unitId: el.unitId,
          unitName: el.unit?.name || null,
          departmentId: el.departmentId,
          departmentName: el.department?.name || null,
          status: el.status,
          startsAt: el.startsAt?.toISOString() || null,
          endsAt: el.endsAt?.toISOString() || null,
          totalVotes,
          hasVoted: Boolean(myVotedCandidateId),
          myVotedCandidateId,
          candidates: el.candidates.map((c, idx) => ({
            id: c.id,
            studentId: c.studentId,
            fullName: c.fullName,
            photoUrl: c.photoUrl,
            departmentName: c.departmentName,
            facultyName: c.facultyName,
            levelCode: c.levelCode,
            manifesto: c.manifesto,
            voteCount: c.voteCount,
            percentage:
              totalVotes > 0 ? Math.round((c.voteCount / totalVotes) * 1000) / 10 : 0,
            rank: idx + 1,
            isLeading: c.voteCount > 0 && c.voteCount === topVotes,
          })),
        };
      });

    const publicPosts = posts.filter((p) => !p.isInternalOnly);
    const internalPosts = posts.filter((p) => p.isInternalOnly);

    const financeSummary = permissions.canViewFinanceReadOnly
      ? {
          isReadOnly: !permissions.isSchoolAdmin,
          totalFeeStructureValue: feeItems.reduce(
            (sum, i) => sum + Math.round(Number(i.amountKobo || 0) / 100),
            0,
          ),
          totalCollected: feePayments.reduce(
            (sum, p) => sum + Math.round(Number(p.amountPaidKobo || 0) / 100),
            0,
          ),
          successfulTransactions: feePayments.length,
          pendingTransactions: 0,
          feeCategories: feeItems.map((i) => ({
            id: i.id,
            title: i.title,
            amount: Math.round(Number(i.amountKobo || 0) / 100),
            isMandatory: i.isMandatory,
          })),
          recentReceipts: feePayments.slice(0, 10).map((p) => ({
            id: p.id,
            title: p.feeItem?.title || 'Campus Fee',
            payerName: p.student?.fullName || 'Student',
            amountPaid: Math.round(Number(p.amountPaidKobo || 0) / 100),
            status: 'SUCCESS',
            paidAt: p.paidAt.toISOString(),
            reference: p.paystackReference,
          })),
        }
      : null;

    const myEndorsementMap = new Map(
      myEndorsementVotes.map((v) => [v.roleId, v.nomineeId]),
    );

    const formattedRoles = roles.map((r) => {
      const eligibleLevels = Array.isArray(r.eligibleLevelsJson)
        ? (r.eligibleLevelsJson as string[]).map((l) => normalizeLvl(l)).filter(Boolean)
        : [];
      return {
        ...r,
        eligibleLevels,
      };
    });

    const endorsementCalls = formattedRoles
      .filter(
        (r) =>
          r.isSelectionOpen ||
          r.dueForElection ||
          allNominees.some((n) => n.roleId === r.id),
      )
      .map((r) => {
        const roleNominees = allNominees.filter((n) => n.roleId === r.id);
        const topCount = roleNominees[0]?.endorsementCount ?? 0;

        let canStudentEndorse = false;
        let endorsementBlockedReason: string | null = null;

        if (!permissions.isStudent) {
          endorsementBlockedReason = permissions.isSchoolAdmin
            ? 'Review top-endorsed peers below and approve fraud-free candidates for election.'
            : 'Students endorse peers within their configured Faculty, Department & Level.';
        } else if (!r.isSelectionOpen) {
          endorsementBlockedReason = 'Selection / peer endorsement window is currently closed.';
        } else if (r.tier === 'FACULTY' && r.unitId && studentUnitId !== r.unitId) {
          endorsementBlockedReason = `Only students in ${r.unit?.name || 'this Faculty'} can select/endorse for this role.`;
        } else if (
          r.tier === 'DEPARTMENT' &&
          r.departmentId &&
          studentDepartmentId !== r.departmentId
        ) {
          endorsementBlockedReason = `Only students in ${r.department?.name || 'this Department'} can select/endorse for this role.`;
        } else if (
          r.eligibleLevels.length > 0 &&
          (!studentLevelCode || !r.eligibleLevels.includes(studentLevelCode))
        ) {
          endorsementBlockedReason = `Restricted to ${r.eligibleLevels.join(', ')} students by School Admin (you are ${studentLevelCode || 'Unassigned'}). You can follow ongoing nominations and vote when the final election goes LIVE.`;
        } else {
          canStudentEndorse = true;
        }

        return {
          roleId: r.id,
          roleTitle: r.title,
          tier: r.tier,
          unitId: r.unitId,
          unitName: r.unit?.name || null,
          departmentId: r.departmentId,
          departmentName: r.department?.name || null,
          isSelectionOpen: r.isSelectionOpen,
          dueForElection: r.dueForElection,
          eligibleLevels: r.eligibleLevels,
          maxEndorsementWinners: r.maxEndorsementWinners,
          canStudentEndorse,
          endorsementBlockedReason,
          myEndorsedNomineeId: myEndorsementMap.get(r.id) || null,
          totalEndorsements: roleNominees.reduce((s, n) => s + n.endorsementCount, 0),
          nominees: roleNominees.map((n, idx) => ({
            ...n,
            rank: idx + 1,
            isTopEndorsed: n.endorsementCount > 0 && n.endorsementCount === topCount,
          })),
        };
      });

    const eligiblePeers = campusStudents.map((stu) => ({
      id: stu.id,
      fullName: stu.fullName,
      avatarUrl: stu.avatarUrl,
      levelCode: normalizeLvl(
        stu.studentProfile?.level ||
          stu.studentProfile?.schoolClass?.levelCode ||
          stu.studentProfile?.schoolClass?.name,
      ),
      departmentId: stu.studentProfile?.departmentId || null,
      departmentName: stu.studentProfile?.department?.name || 'General Department',
      unitId: stu.studentProfile?.department?.unitId || null,
      facultyName: stu.studentProfile?.department?.unit?.name || null,
    }));

    return {
      isTertiary: true,
      school,
      permissions,
      actorContext: {
        levelCode: studentLevelCode || null,
        departmentId: studentDepartmentId,
        departmentName: actor.user.studentProfile?.department?.name || null,
        unitId: studentUnitId,
        unitName: actor.user.studentProfile?.department?.unit?.name || null,
      },
      myOffices: activeOffices.map((o) => ({
        id: o.id,
        roleId: o.roleId,
        title: o.role.title,
        tier: o.role.tier,
      })),
      roles: formattedRoles,
      executives,
      elections: formattedElections,
      endorsementCalls,
      eligiblePeers,
      publicPosts,
      internalPosts,
      welfareTickets: tickets,
      financeSummary,
      hierarchy: { faculties, departments, classes },
    };
  }

  async listCandidateStudents(userId: string, explicitSchoolId?: string) {
    const actor = await this.resolveActor(userId, explicitSchoolId);
    if (!actor.permissions.canManageRolesAndElections && !actor.permissions.isExecutive) {
      throw new ForbiddenException('Only School Admin or authorized SUG officers can browse student directory for appointments.');
    }

    const students = await this.prisma.user.findMany({
      where: {
        role: 'STUDENT',
        OR: [
          { schoolId: actor.schoolId },
          { studentProfile: { schoolId: actor.schoolId } },
          { memberships: { some: { schoolId: actor.schoolId, role: 'STUDENT' } } },
        ],
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        studentProfile: {
          select: {
            level: true,
            matricOrAdmissionNo: true,
            departmentId: true,
            department: {
              select: {
                id: true,
                name: true,
                code: true,
                unit: { select: { id: true, name: true } },
              },
            },
            schoolClass: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
      take: 250,
    });

    return { students };
  }

  async upsertRoleConfig(
    userId: string,
    dto: {
      id?: string;
      schoolId?: string;
      title: string;
      tier?: SugTier;
      unitId?: string | null;
      departmentId?: string | null;
      description?: string;
      dueForElection?: boolean;
      isSelectionOpen?: boolean;
      eligibleLevels?: string[];
      maxEndorsementWinners?: number;
      canViewFinanceReadOnly?: boolean;
      canPostPublicUpdates?: boolean;
      canPostOpportunities?: boolean;
      canManageWelfare?: boolean;
      canManageElections?: boolean;
      canPostInternal?: boolean;
      maxHolders?: number;
    },
  ) {
    const actor = await this.resolveActor(userId, dto.schoolId);
    if (!actor.permissions.isSchoolAdmin) {
      throw new ForbiddenException('Only School Admins can configure SUG leadership roles.');
    }
    if (!dto.title?.trim()) {
      throw new BadRequestException('Role title is required.');
    }

    const cleanedLevels = Array.isArray(dto.eligibleLevels)
      ? Array.from(
          new Set(
            dto.eligibleLevels
              .map((l) => String(l).trim().toUpperCase())
              .filter(Boolean),
          ),
        )
      : undefined;

    const data: any = {
      schoolId: actor.schoolId,
      title: dto.title.trim(),
      tier: dto.tier || 'SUG_CENTRAL',
      unitId: dto.unitId || null,
      departmentId: dto.departmentId || null,
      description: dto.description?.trim() || null,
      dueForElection: Boolean(dto.dueForElection),
      isSelectionOpen:
        dto.isSelectionOpen !== undefined ? Boolean(dto.isSelectionOpen) : undefined,
      eligibleLevelsJson: cleanedLevels !== undefined ? cleanedLevels : undefined,
      maxEndorsementWinners: dto.maxEndorsementWinners
        ? Math.max(1, Number(dto.maxEndorsementWinners))
        : undefined,
      canViewFinanceReadOnly: Boolean(dto.canViewFinanceReadOnly),
      canPostPublicUpdates: dto.canPostPublicUpdates ?? true,
      canPostOpportunities: Boolean(dto.canPostOpportunities),
      canManageWelfare: Boolean(dto.canManageWelfare),
      canManageElections: Boolean(dto.canManageElections),
      canPostInternal: dto.canPostInternal ?? true,
      maxHolders: Math.max(1, Number(dto.maxHolders) || 1),
      isActive: true,
    };

    const role = dto.id
      ? await this.prisma.sugRoleConfig.update({
          where: { id: dto.id },
          data,
        })
      : await this.prisma.sugRoleConfig.create({ data });

    return { success: true, role };
  }

  async openRoleSelectionCall(
    userId: string,
    dto: {
      schoolId?: string;
      roleId: string;
      eligibleLevels?: string[];
      unitId?: string | null;
      departmentId?: string | null;
      announcementNote?: string;
      isOpen?: boolean;
    },
  ) {
    const role = await this.prisma.sugRoleConfig.findUnique({
      where: { id: dto.roleId },
      include: { unit: true, department: true },
    });
    if (!role) throw new NotFoundException('SUG Role not found.');

    const actor = await this.resolveActor(userId, dto.schoolId || role.schoolId);
    if (!actor.permissions.canManageRolesAndElections) {
      throw new ForbiddenException('Only School Admin or Electoral Admin can open peer selection/endorsement.');
    }

    const isOpen = dto.isOpen ?? true;
    const cleanedLevels = Array.isArray(dto.eligibleLevels)
      ? Array.from(new Set(dto.eligibleLevels.map((l) => l.trim().toUpperCase()).filter(Boolean)))
      : (Array.isArray(role.eligibleLevelsJson) ? (role.eligibleLevelsJson as string[]) : []);

    const updated = await this.prisma.sugRoleConfig.update({
      where: { id: role.id },
      data: {
        dueForElection: true,
        isSelectionOpen: isOpen,
        eligibleLevelsJson: cleanedLevels,
        unitId: dto.unitId !== undefined ? dto.unitId : role.unitId,
        departmentId: dto.departmentId !== undefined ? dto.departmentId : role.departmentId,
      },
      include: { unit: true, department: true },
    });

    if (isOpen) {
      const levelDesc =
        cleanedLevels.length > 0
          ? `Restricted to ${cleanedLevels.join(', ')} students`
          : 'All levels in scope';
      const scopeName =
        updated.department?.name ||
        updated.unit?.name ||
        actor.school.name;
      const bodyText =
        dto.announcementNote?.trim() ||
        `Peer nominations and endorsements are now open for ${updated.title} (${scopeName}). Eligibility: ${levelDesc}. Highest-endorsed mates will undergo School Admin fraud verification before live voting begins.`;

      await this.prisma.sugPost.create({
        data: {
          schoolId: actor.schoolId,
          authorId: userId,
          category: 'ANNOUNCEMENT',
          title: `Election Selection Open: ${updated.title}`,
          body: bodyText,
          isPinned: true,
          isInternalOnly: false,
        },
      });

      const students = await this.prisma.user.findMany({
        where: {
          role: 'STUDENT',
          OR: [{ schoolId: actor.schoolId }, { studentProfile: { schoolId: actor.schoolId } }],
        },
        select: { id: true },
        take: 400,
      });
      await Promise.allSettled(
        students.map((s) =>
          this.notifications.dispatchNotification({
            userId: s.id,
            schoolId: actor.schoolId,
            title: `Selection Open: ${updated.title}`,
            body: bodyText,
            category: 'SYSTEM',
            deepLink: '/sugHub',
            channels: { inApp: true, push: true },
          }),
        ),
      );
    }

    this.gateway.emitElectionUpdate(actor.schoolId, {
      type: 'SELECTION_CALL_UPDATED',
      roleId: updated.id,
      isSelectionOpen: isOpen,
    });

    return { success: true, role: updated };
  }

  async endorseOrNominatePeer(
    userId: string,
    dto: {
      roleId: string;
      nomineeUserId: string;
      manifesto?: string;
    },
  ) {
    const role = await this.prisma.sugRoleConfig.findUnique({
      where: { id: dto.roleId },
      include: { unit: true, department: true },
    });
    if (!role) throw new NotFoundException('SUG Role not found.');

    const actor = await this.resolveActor(userId, role.schoolId);
    if (!actor.permissions.isStudent) {
      throw new ForbiddenException('Only students can nominate or endorse classmates.');
    }
    if (!role.isSelectionOpen) {
      throw new ForbiddenException('Selection & peer endorsement is closed for this role.');
    }

    const normalizeLvl = (raw?: string | null): string => {
      const m = String(raw || '').match(/(100|200|300|400|500|600|ND\s*[12]|HND\s*[12])/i);
      if (m) return m[1].replace(/\s+/g, '').toUpperCase().replace(/^(\d{3})$/, '$1L');
      return String(raw || '').trim().toUpperCase();
    };

    const actorLevel = normalizeLvl(
      actor.user.studentProfile?.level || actor.user.studentProfile?.schoolClass?.levelCode || actor.user.studentProfile?.schoolClass?.name,
    );
    const actorDeptId = actor.user.studentProfile?.departmentId || null;
    const actorUnitId = actor.user.studentProfile?.department?.unitId || null;

    if (role.tier === 'FACULTY' && role.unitId && actorUnitId !== role.unitId) {
      throw new ForbiddenException(
        `Only students in ${role.unit?.name || 'this Faculty'} can select or endorse for ${role.title}.`,
      );
    }
    if (role.tier === 'DEPARTMENT' && role.departmentId && actorDeptId !== role.departmentId) {
      throw new ForbiddenException(
        `Only students in ${role.department?.name || 'this Department'} can select or endorse for ${role.title}.`,
      );
    }

    const eligibleLevels = Array.isArray(role.eligibleLevelsJson)
      ? (role.eligibleLevelsJson as string[]).map((l) => normalizeLvl(l)).filter(Boolean)
      : [];
    if (eligibleLevels.length > 0 && (!actorLevel || !eligibleLevels.includes(actorLevel))) {
      throw new ForbiddenException(
        `Selection for ${role.title} is configured strictly for ${eligibleLevels.join(', ')} students. Other levels can follow activities and vote when the final election opens.`,
      );
    }

    const existingVote = await this.prisma.sugEndorsementVote.findUnique({
      where: { roleId_voterId: { roleId: role.id, voterId: userId } },
    });
    if (existingVote) {
      throw new ConflictException('You have already endorsed a peer for this position.');
    }

    const nomineeUser = await this.prisma.user.findUnique({
      where: { id: dto.nomineeUserId },
      include: {
        studentProfile: {
          include: {
            department: { include: { unit: true } },
            schoolClass: { select: { name: true, levelCode: true } },
          },
        },
      },
    });
    if (!nomineeUser || nomineeUser.role !== 'STUDENT') {
      throw new NotFoundException('Target classmate not found.');
    }

    const nomDeptId = nomineeUser.studentProfile?.departmentId || null;
    const nomUnitId = nomineeUser.studentProfile?.department?.unitId || null;
    const nomLevel = normalizeLvl(
      nomineeUser.studentProfile?.level || nomineeUser.studentProfile?.schoolClass?.levelCode || nomineeUser.studentProfile?.schoolClass?.name,
    );

    if (role.tier === 'FACULTY' && role.unitId && nomUnitId !== role.unitId) {
      throw new ForbiddenException('Selected nominee must belong to the same Faculty.');
    }
    if (role.tier === 'DEPARTMENT' && role.departmentId && nomDeptId !== role.departmentId) {
      throw new ForbiddenException('Selected nominee must belong to the same Department.');
    }
    if (eligibleLevels.length > 0 && (!nomLevel || !eligibleLevels.includes(nomLevel))) {
      throw new ForbiddenException(
        `Candidate must belong to an eligible level (${eligibleLevels.join(', ')}).`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let nominee = await tx.sugEndorsementNominee.findUnique({
        where: {
          roleId_nomineeUserId: { roleId: role.id, nomineeUserId: nomineeUser.id },
        },
      });

      if (!nominee) {
        nominee = await tx.sugEndorsementNominee.create({
          data: {
            schoolId: role.schoolId,
            roleId: role.id,
            nomineeUserId: nomineeUser.id,
            nominatedById: userId,
            unitId: nomUnitId,
            departmentId: nomDeptId,
            fullName: nomineeUser.fullName || 'Student Nominee',
            photoUrl: nomineeUser.avatarUrl,
            departmentName:
              nomineeUser.studentProfile?.department?.name || 'General Department',
            facultyName: nomineeUser.studentProfile?.department?.unit?.name || null,
            levelCode: nomLevel || actorLevel || '200L',
            manifesto: dto.manifesto?.trim() || null,
            endorsementCount: 1,
          },
        });
      } else {
        nominee = await tx.sugEndorsementNominee.update({
          where: { id: nominee.id },
          data: { endorsementCount: { increment: 1 } },
        });
      }

      await tx.sugEndorsementVote.create({
        data: {
          roleId: role.id,
          nomineeId: nominee.id,
          voterId: userId,
        },
      });

      return nominee;
    });

    this.gateway.emitElectionUpdate(role.schoolId, {
      type: 'ENDORSEMENT_RECORDED',
      roleId: role.id,
      nomineeId: result.id,
      endorsementCount: result.endorsementCount,
    });

    return { success: true, nominee: result };
  }

  async approveEndorsedCandidatesAndLaunchElection(
    userId: string,
    dto: {
      roleId: string;
      nomineeIds?: string[];
      launchLiveNow?: boolean;
      electionTitle?: string;
    },
  ) {
    const role = await this.prisma.sugRoleConfig.findUnique({
      where: { id: dto.roleId },
      include: { unit: true, department: true },
    });
    if (!role) throw new NotFoundException('SUG Role not found.');

    const actor = await this.resolveActor(userId, role.schoolId);
    if (!actor.permissions.canManageRolesAndElections) {
      throw new ForbiddenException('Only School Admin / Electoral Commission can verify & approve endorsed candidates.');
    }

    const rankedNominees = await this.prisma.sugEndorsementNominee.findMany({
      where: { roleId: role.id, status: { not: 'REJECTED' } },
      orderBy: [{ endorsementCount: 'desc' }, { createdAt: 'asc' }],
    });
    if (rankedNominees.length === 0) {
      throw new BadRequestException('No endorsed peers available yet for this role.');
    }

    const pickedNominees =
      dto.nomineeIds && dto.nomineeIds.length > 0
        ? rankedNominees.filter((n) => dto.nomineeIds!.includes(n.id))
        : rankedNominees.slice(0, role.maxEndorsementWinners || 3);

    if (pickedNominees.length === 0) {
      throw new BadRequestException('Select at least one verified nominee to approve.');
    }

    const launchLiveNow = dto.launchLiveNow ?? true;

    let election = await this.prisma.sugElection.findFirst({
      where: { schoolId: role.schoolId, roleId: role.id, status: { in: ['UPCOMING', 'LIVE'] } },
      include: { candidates: true },
    });

    if (!election) {
      election = await this.prisma.sugElection.create({
        data: {
          schoolId: role.schoolId,
          roleId: role.id,
          title: dto.electionTitle?.trim() || `${role.title} Election`,
          description: `Approved candidates from peer selection (top endorsed). Every eligible student can now vote.`,
          scopeTier: role.tier,
          unitId: role.unitId,
          departmentId: role.departmentId,
          status: launchLiveNow ? 'LIVE' : 'UPCOMING',
          startsAt: launchLiveNow ? new Date() : null,
          createdById: userId,
        },
        include: { candidates: true },
      });
    } else if (launchLiveNow && election.status !== 'LIVE') {
      election = await this.prisma.sugElection.update({
        where: { id: election.id },
        data: { status: 'LIVE', startsAt: new Date() },
        include: { candidates: true },
      });
    }

    const existingStudentIds = new Set(
      election.candidates.map((c) => c.studentId).filter(Boolean),
    );

    for (const nom of pickedNominees) {
      await this.prisma.sugEndorsementNominee.update({
        where: { id: nom.id },
        data: { status: 'APPROVED_FOR_ELECTION', approvedById: userId },
      });

      if (!existingStudentIds.has(nom.nomineeUserId)) {
        await this.prisma.sugElectionCandidate.create({
          data: {
            electionId: election.id,
            studentId: nom.nomineeUserId,
            fullName: nom.fullName,
            photoUrl: nom.photoUrl,
            departmentName: nom.departmentName,
            facultyName: nom.facultyName,
            levelCode: nom.levelCode,
            manifesto: nom.manifesto || `Top-endorsed peer (${nom.endorsementCount} endorsements).`,
          },
        });
      }
    }

    await this.prisma.sugRoleConfig.update({
      where: { id: role.id },
      data: { isSelectionOpen: false, dueForElection: true },
    });

    this.gateway.emitElectionUpdate(role.schoolId, {
      type: 'ELECTION_APPROVED_AND_LAUNCHED',
      electionId: election.id,
      status: election.status,
    });

    return {
      success: true,
      electionId: election.id,
      approvedCount: pickedNominees.length,
    };
  }

  async appointOfficeHolder(
    userId: string,
    dto: {
      schoolId?: string;
      roleId: string;
      targetUserId: string;
      unitId?: string | null;
      departmentId?: string | null;
      classId?: string | null;
      tenureLabel?: string;
      manifestoOrBio?: string;
      photoBase64?: string;
      photoUrl?: string;
    },
  ) {
    const actor = await this.resolveActor(userId, dto.schoolId);
    if (!actor.permissions.isSchoolAdmin) {
      throw new ForbiddenException('Only School Admins can appoint SUG office holders.');
    }
    if (!dto.roleId || !dto.targetUserId) {
      throw new BadRequestException('roleId and targetUserId are required.');
    }

    const uploadedPhoto = await this.resolveCandidatePhoto(
      dto.photoBase64,
      dto.photoUrl,
    );

    const holder = await this.prisma.sugOfficeHolder.create({
      data: {
        schoolId: actor.schoolId,
        roleId: dto.roleId,
        userId: dto.targetUserId,
        unitId: dto.unitId || null,
        departmentId: dto.departmentId || null,
        classId: dto.classId || null,
        tenureLabel: dto.tenureLabel?.trim() || '2025/2026',
        manifestoOrBio: dto.manifestoOrBio?.trim() || null,
        photoUrl: uploadedPhoto,
        appointedById: userId,
        isActive: true,
      },
      include: {
        role: true,
        user: { select: { id: true, fullName: true } },
      },
    });

    return { success: true, holder };
  }

  async removeOfficeHolder(userId: string, holderId: string) {
    const holder = await this.prisma.sugOfficeHolder.findUnique({
      where: { id: holderId },
    });
    if (!holder) throw new NotFoundException('Office holder record not found.');
    const actor = await this.resolveActor(userId, holder.schoolId);
    if (!actor.permissions.isSchoolAdmin) {
      throw new ForbiddenException('Only School Admins can remove SUG office holders.');
    }

    await this.prisma.sugOfficeHolder.update({
      where: { id: holderId },
      data: { isActive: false },
    });
    return { success: true };
  }

  async createElection(
    userId: string,
    dto: {
      schoolId?: string;
      roleId: string;
      title?: string;
      description?: string;
      unitId?: string | null;
      departmentId?: string | null;
      status?: 'UPCOMING' | 'LIVE' | 'CLOSED';
      endsAt?: string | null;
    },
  ) {
    const actor = await this.resolveActor(userId, dto.schoolId);
    if (!actor.permissions.canManageRolesAndElections) {
      throw new ForbiddenException('Only School Admin / Electoral Commission can configure elections.');
    }

    const role = await this.prisma.sugRoleConfig.findUnique({
      where: { id: dto.roleId },
    });
    if (!role || role.schoolId !== actor.schoolId) {
      throw new NotFoundException('SUG role not found for this institution.');
    }

    // Mark role as dueForElection
    await this.prisma.sugRoleConfig.update({
      where: { id: role.id },
      data: { dueForElection: true },
    });

    const election = await this.prisma.sugElection.create({
      data: {
        schoolId: actor.schoolId,
        roleId: role.id,
        title: dto.title?.trim() || `${role.title} Election`,
        description: dto.description?.trim() || null,
        scopeTier: role.tier,
        unitId: dto.unitId || role.unitId || null,
        departmentId: dto.departmentId || role.departmentId || null,
        status: dto.status || 'LIVE',
        startsAt: dto.status === 'LIVE' ? new Date() : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        createdById: userId,
      },
    });

    this.gateway.emitElectionUpdate(actor.schoolId, {
      type: 'ELECTION_CREATED',
      electionId: election.id,
      status: election.status,
      title: election.title,
    });

    return { success: true, election };
  }

  async updateElectionStatus(
    userId: string,
    electionId: string,
    status: 'UPCOMING' | 'LIVE' | 'CLOSED',
  ) {
    const election = await this.prisma.sugElection.findUnique({
      where: { id: electionId },
    });
    if (!election) throw new NotFoundException('Election not found.');

    const actor = await this.resolveActor(userId, election.schoolId);
    if (!actor.permissions.canManageRolesAndElections) {
      throw new ForbiddenException('Only School Admin / Electoral Commission can update election status.');
    }

    const updated = await this.prisma.sugElection.update({
      where: { id: electionId },
      data: {
        status,
        startsAt: status === 'LIVE' && !election.startsAt ? new Date() : election.startsAt,
        endsAt: status === 'CLOSED' ? new Date() : election.endsAt,
      },
    });

    if (status === 'CLOSED') {
      await this.prisma.sugRoleConfig.update({
        where: { id: election.roleId },
        data: { dueForElection: false },
      });
    }

    this.gateway.emitElectionUpdate(election.schoolId, {
      type: 'ELECTION_STATUS_CHANGED',
      electionId: updated.id,
      status: updated.status,
      title: updated.title,
    });

    return { success: true, election: updated };
  }

  async addElectionCandidate(
    userId: string,
    electionId: string,
    dto: {
      studentId?: string;
      fullName?: string;
      departmentName?: string;
      facultyName?: string;
      levelCode?: string;
      manifesto?: string;
      photoBase64?: string;
      photoUrl?: string;
    },
  ) {
    const election = await this.prisma.sugElection.findUnique({
      where: { id: electionId },
    });
    if (!election) throw new NotFoundException('Election not found.');

    const actor = await this.resolveActor(userId, election.schoolId);
    if (!actor.permissions.canManageRolesAndElections) {
      throw new ForbiddenException('Only School Admin / Electoral Commission can add candidates.');
    }

    let fullName = dto.fullName?.trim() || '';
    let departmentName = dto.departmentName?.trim() || '';
    let facultyName = dto.facultyName?.trim() || '';
    let levelCode = dto.levelCode?.trim() || '200L';
    let fallbackAvatar: string | null = null;

    if (dto.studentId) {
      const stu = await this.prisma.user.findUnique({
        where: { id: dto.studentId },
        include: {
          studentProfile: {
            include: { department: { include: { unit: true } } },
          },
        },
      });
      if (stu) {
        fullName = fullName || stu.fullName || '';
        departmentName =
          departmentName || stu.studentProfile?.department?.name || 'General Department';
        facultyName =
          facultyName || stu.studentProfile?.department?.unit?.name || '';
        levelCode = levelCode || stu.studentProfile?.level || '200L';
        fallbackAvatar = stu.avatarUrl;
      }
    }

    if (!fullName || !departmentName) {
      throw new BadRequestException('Candidate fullName and departmentName are required.');
    }

    const uploadedPhoto = await this.resolveCandidatePhoto(
      dto.photoBase64,
      dto.photoUrl || fallbackAvatar || undefined,
    );

    const candidate = await this.prisma.sugElectionCandidate.create({
      data: {
        electionId,
        studentId: dto.studentId || null,
        fullName,
        photoUrl: uploadedPhoto,
        departmentName,
        facultyName: facultyName || null,
        levelCode,
        manifesto: dto.manifesto?.trim() || null,
        isApproved: true,
      },
    });

    this.gateway.emitElectionUpdate(election.schoolId, {
      type: 'CANDIDATE_ADDED',
      electionId,
      candidateId: candidate.id,
    });

    return { success: true, candidate };
  }

  async castVote(userId: string, electionId: string, candidateId: string) {
    const election = await this.prisma.sugElection.findUnique({
      where: { id: electionId },
      include: { role: true },
    });
    if (!election) throw new NotFoundException('Election not found.');
    if (election.status !== 'LIVE') {
      throw new BadRequestException('Voting is not currently live for this post.');
    }

    const actor = await this.resolveActor(userId, election.schoolId);
    if (!actor.permissions.canVote) {
      throw new ForbiddenException('Only enrolled students can cast ballots in SUG elections.');
    }

    // Scope eligibility check: Faculty post -> matching Faculty; Dept post -> matching Department
    const voterDeptId = actor.user.studentProfile?.departmentId || null;
    const voterUnitId = actor.user.studentProfile?.department?.unitId || null;

    if (election.scopeTier === 'FACULTY' && election.unitId && voterUnitId && voterUnitId !== election.unitId) {
      throw new ForbiddenException('This Faculty election is restricted to students inside that Faculty.');
    }
    if (election.scopeTier === 'DEPARTMENT' && election.departmentId && voterDeptId && voterDeptId !== election.departmentId) {
      throw new ForbiddenException('This Departmental election is restricted to students in that Department.');
    }

    const candidate = await this.prisma.sugElectionCandidate.findFirst({
      where: { id: candidateId, electionId, isApproved: true },
    });
    if (!candidate) {
      throw new NotFoundException('Candidate not found in this election.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sugElectionVote.findUnique({
        where: { electionId_voterId: { electionId, voterId: userId } },
      });
      if (existing) {
        throw new ConflictException('You have already voted for this post.');
      }

      const vote = await tx.sugElectionVote.create({
        data: { electionId, candidateId, voterId: userId },
      });

      const updatedCandidate = await tx.sugElectionCandidate.update({
        where: { id: candidateId },
        data: { voteCount: { increment: 1 } },
      });

      return { vote, updatedCandidate };
    });

    this.gateway.emitElectionUpdate(election.schoolId, {
      type: 'VOTE_CAST',
      electionId,
      candidateId,
      newVoteCount: result.updatedCandidate.voteCount,
      voterCountIncremented: true,
      updatedAt: new Date().toISOString(),
    });

    return {
      success: true,
      electionId,
      candidateId,
      newVoteCount: result.updatedCandidate.voteCount,
    };
  }

  async createPost(
    userId: string,
    dto: {
      schoolId?: string;
      category?: string;
      title: string;
      body: string;
      amountOrStipend?: string;
      deadline?: string;
      externalLink?: string;
      isInternalOnly?: boolean;
      isNationwidePublic?: boolean;
      isPinned?: boolean;
    },
  ) {
    const actor = await this.resolveActor(userId, dto.schoolId);
    const category = String(dto.category || 'UPDATE').toUpperCase();

    if (dto.isInternalOnly) {
      if (!actor.permissions.canPostInternal) {
        throw new ForbiddenException('Only SUG Executives and School Admin can create internal Exco notes.');
      }
    } else if (category === 'SCHOLARSHIP' || category === 'VACANCY') {
      if (!actor.permissions.canPostOpportunities && !actor.permissions.canPostPublicUpdates) {
        throw new ForbiddenException('Your role does not have permission to publish SUG opportunities.');
      }
    } else if (!actor.permissions.canPostPublicUpdates) {
      throw new ForbiddenException('Only authorized SUG Executives and School Admin can publish SUG updates.');
    }

    if (!dto.title?.trim() || !dto.body?.trim()) {
      throw new BadRequestException('Title and message body are required.');
    }

    const authorRoleTitle =
      actor.activeOffices[0]?.role.title ||
      (actor.permissions.isSchoolAdmin ? 'School Management' : 'SUG Executive');

    const post = await this.prisma.sugPost.create({
      data: {
        schoolId: actor.schoolId,
        authorId: userId,
        authorRoleTitle,
        category,
        title: dto.title.trim(),
        body: dto.body.trim(),
        amountOrStipend: dto.amountOrStipend?.trim() || null,
        deadline: dto.deadline?.trim() || null,
        externalLink: dto.externalLink?.trim() || null,
        isInternalOnly: Boolean(dto.isInternalOnly),
        isNationwidePublic: Boolean(!dto.isInternalOnly && dto.isNationwidePublic),
        isPinned: Boolean(dto.isPinned),
      },
      include: {
        author: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });

    this.gateway.emitPostCreated(
      actor.schoolId,
      post.isNationwidePublic,
      { post },
    );

    if (!post.isInternalOnly) {
      void this.notifySchoolAboutSugPost(actor.schoolId, post);
    }

    return { success: true, post };
  }

  private async notifySchoolAboutSugPost(
    schoolId: string,
    post: { id: string; title: string; category: string; authorRoleTitle: string },
  ) {
    try {
      const members = await this.prisma.user.findMany({
        where: {
          OR: [
            { schoolId },
            { studentProfile: { schoolId } },
            { teacherProfile: { schoolId } },
          ],
          role: { in: ['STUDENT', 'TEACHER'] },
        },
        select: { id: true },
        take: 150,
      });

      await Promise.allSettled(
        members.map((m) =>
          this.notifications.dispatchNotification({
            userId: m.id,
            schoolId,
            title: `SUG ${post.category}: ${post.title}`,
            body: `Published by ${post.authorRoleTitle}`,
            category: 'ANNOUNCEMENT',
            deepLink: '/sugHub',
            dataJson: { sugPostId: post.id },
            channels: { inApp: true, push: true, email: false },
          }),
        ),
      );
    } catch {
      // Non-critical notification dispatch
    }
  }

  async submitWelfareTicket(
    userId: string,
    dto: {
      schoolId?: string;
      category?: string;
      title: string;
      description: string;
      isPublicSummary?: boolean;
    },
  ) {
    const actor = await this.resolveActor(userId, dto.schoolId);
    if (!dto.title?.trim() || !dto.description?.trim()) {
      throw new BadRequestException('Title and description are required.');
    }

    const ticket = await this.prisma.sugWelfareTicket.create({
      data: {
        schoolId: actor.schoolId,
        reporterId: userId,
        category: String(dto.category || 'WELFARE').toUpperCase(),
        title: dto.title.trim(),
        description: dto.description.trim(),
        isPublicSummary: dto.isPublicSummary ?? true,
      },
    });

    return { success: true, ticket };
  }

  async updateWelfareTicket(
    userId: string,
    ticketId: string,
    dto: {
      status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
      resolutionNote?: string;
    },
  ) {
    const ticket = await this.prisma.sugWelfareTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Welfare ticket not found.');

    const actor = await this.resolveActor(userId, ticket.schoolId);
    if (!actor.permissions.canManageWelfare && !actor.permissions.isSchoolAdmin) {
      throw new ForbiddenException('Only Welfare Executives or School Admin can update ticket status.');
    }

    const updated = await this.prisma.sugWelfareTicket.update({
      where: { id: ticketId },
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote?.trim() || ticket.resolutionNote,
      },
    });

    return { success: true, ticket: updated };
  }

  async getConversation(userId: string, peerUserId: string) {
    const peer = await this.prisma.user.findUnique({
      where: { id: peerUserId },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        school: { select: { id: true, name: true } },
        sugOfficeHolders: {
          where: { isActive: true },
          include: { role: { select: { title: true } } },
          take: 2,
        },
      },
    });
    if (!peer) throw new NotFoundException('Leader or recipient not found.');

    const messages = await this.prisma.sugLeaderMessage.findMany({
      where: {
        OR: [
          { senderId: userId, recipientId: peerUserId },
          { senderId: peerUserId, recipientId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    await this.prisma.sugLeaderMessage.updateMany({
      where: { senderId: peerUserId, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    return {
      peer: {
        id: peer.id,
        fullName: peer.fullName,
        avatarUrl: peer.avatarUrl,
        schoolName: peer.school?.name || 'Campus',
        officeTitle: peer.sugOfficeHolders?.[0]?.role.title || 'Campus Leader',
      },
      messages,
    };
  }

  async sendMessage(
    userId: string,
    peerUserId: string,
    dto: { message: string; isNationwide?: boolean },
  ) {
    if (!dto.message?.trim()) {
      throw new BadRequestException('Message text cannot be empty.');
    }
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, schoolId: true },
    });
    if (!sender) throw new NotFoundException('Sender not found.');

    const msg = await this.prisma.sugLeaderMessage.create({
      data: {
        schoolId: sender.schoolId || null,
        senderId: userId,
        recipientId: peerUserId,
        isNationwide: Boolean(dto.isNationwide),
        message: dto.message.trim(),
      },
    });

    this.gateway.emitLeaderMessage(peerUserId, userId, msg);

    void this.notifications.dispatchNotification({
      userId: peerUserId,
      schoolId: sender.schoolId || undefined,
      title: `SUG Message from ${sender.fullName}`,
      body: msg.message.slice(0, 120),
      category: 'COMMUNITY',
      deepLink: '/sugHub',
      dataJson: { peerUserId: userId },
      channels: { inApp: true, push: true, email: false },
    });

    return { success: true, message: msg };
  }

  async getNationwideDirectory(userId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true },
    });
    if (!actor) throw new NotFoundException('User not found.');

    const [leaders, nationwidePosts] = await Promise.all([
      this.prisma.sugOfficeHolder.findMany({
        where: {
          isActive: true,
          role: {
            tier: { in: ['SUG_CENTRAL', 'FACULTY'] },
          },
          school: {
            institutionType: {
              in: ['UNIVERSITY', 'POLYTECHNIC'],
            },
          },
        },
        include: {
          role: { select: { title: true, tier: true } },
          school: { select: { id: true, name: true, institutionType: true } },
          user: { select: { id: true, fullName: true, avatarUrl: true } },
          department: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      }),
      this.prisma.sugPost.findMany({
        where: { isInternalOnly: false, isNationwidePublic: true },
        include: {
          school: { select: { id: true, name: true } },
          author: { select: { id: true, fullName: true } },
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
    ]);

    return {
      leaders: leaders.map((l) => ({
        id: l.id,
        userId: l.userId,
        fullName: l.user.fullName,
        avatarUrl: l.photoUrl || l.user.avatarUrl || null,
        roleTitle: l.role.title,
        tier: l.role.tier,
        schoolId: l.schoolId,
        schoolName: l.school.name,
        institutionType: l.school.institutionType,
        departmentName: l.department?.name || null,
        tenureLabel: l.tenureLabel,
        isMySchool: l.schoolId === actor.schoolId,
      })),
      posts: nationwidePosts,
    };
  }
}
