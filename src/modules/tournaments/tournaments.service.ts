import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  AdminRegisterStudentsDto,
  CreateTournamentDto,
  ReportAntiCheatEventDto,
  SendSpectatorCheerDto,
  SubmitTournamentAnswerDto,
} from './dto/tournaments.dto.js';
import { TournamentsGateway } from './gateways/tournaments.gateway.js';
import {
  EligibilityEvaluationResult,
  evaluateStudentEligibility,
  StudentEligibilityContext,
} from './utils/eligibility-validator.util.js';
import { resolveQuestionBank } from './utils/olympiad-question-bank.util.js';

const STAFF_ROLES = new Set(['SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN']);

const ENTRY_USER_SELECT = {
  id: true,
  fullName: true,
  avatarUrl: true,
  role: true,
  schoolId: true,
  school: {
    select: {
      id: true,
      name: true,
      schoolCode: true,
      institutionType: true,
    },
  },
} as const;

interface StoredAnswerItem {
  questionId: string;
  orderIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
}

@Injectable()
export class TournamentsService {
  private bootstrapped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: TournamentsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  private generateCode(subjectArea: string): string {
    const clean =
      subjectArea
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 4) || 'OLY';
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `OLY-${clean}-${rand}`;
  }

  /**
   * Auto-seeds 3 representative Nigerian Olympiads once if the table is empty
   * (University Engineering/CS, Secondary JSS STEM with strict Admin Approval + Quota, and National Open Cup).
   */
  private async ensureDefaultOlympiads(fallbackUserId: string): Promise<void> {
    if (this.bootstrapped) return;

    const count = await this.prisma.academicTournament.count();
    if (count === 0) {
      const superAdmin = await this.prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' },
        select: { id: true },
      });
      const platformCreatorId = superAdmin?.id || fallbackUserId;
      const seeds: Array<{
        code: string;
        title: string;
        description: string;
        subjectArea: string;
        questionBankKey: 'ENGINEERING_CS' | 'SECONDARY_STEM' | 'NATIONAL_SCHOLARS';
        status: string;
        targetInstitutionTypes: string[];
        allowedDepartments: string[];
        allowedLevels: string[];
        allowIndependentLearners: boolean;
        maxParticipantsPerSchool: number;
        maxTotalParticipants: number;
        requireAdminApproval: boolean;
        secondsPerQuestion: number;
        maxTabSwitchesAllowed: number;
        prizePoolText: string;
        xpRewardFirst: number;
        xpRewardSecond: number;
        xpRewardThird: number;
      }> = [
        {
          code: 'OLY-UNI-ENG-2026',
          title: 'National Engineering & Computing Olympiad',
          description:
            'Inter-university timed Olympiad strictly verifying Engineering & Computer Science undergraduates in 200L–300L.',
          subjectArea: 'Engineering & Computing',
          questionBankKey: 'ENGINEERING_CS',
          status: 'LIVE',
          targetInstitutionTypes: ['UNIVERSITY', 'POLYTECHNIC'],
          allowedDepartments: ['EEE', 'CSC', 'MEE'],
          allowedLevels: ['200L', '300L'],
          allowIndependentLearners: false,
          maxParticipantsPerSchool: 4,
          maxTotalParticipants: 120,
          requireAdminApproval: false,
          secondsPerQuestion: 20,
          maxTabSwitchesAllowed: 2,
          prizePoolText: '₦250,000 Innovation Grant + 500 XP',
          xpRewardFirst: 500,
          xpRewardSecond: 300,
          xpRewardThird: 200,
        },
        {
          code: 'OLY-SEC-STEM-2026',
          title: 'All-Nigeria Junior Secondary STEM Cup',
          description:
            'National secondary schools Science & Mathematics competition. Principals nominate up to 3 JSS 1–2 delegates per school.',
          subjectArea: 'Junior Secondary STEM',
          questionBankKey: 'SECONDARY_STEM',
          status: 'REGISTRATION_OPEN',
          targetInstitutionTypes: ['SECONDARY'],
          allowedDepartments: [],
          allowedLevels: ['JSS 1', 'JSS 2'],
          allowIndependentLearners: false,
          maxParticipantsPerSchool: 3,
          maxTotalParticipants: 150,
          requireAdminApproval: true,
          secondsPerQuestion: 20,
          maxTabSwitchesAllowed: 2,
          prizePoolText: 'Gold School Trophy + ₦100,000 Lab Grant',
          xpRewardFirst: 450,
          xpRewardSecond: 250,
          xpRewardThird: 150,
        },
        {
          code: 'OLY-NAT-OPEN-2026',
          title: 'National Open Scholars Live Cup',
          description:
            'Cross-campus & independent learners general aptitude showdown with live spectator stream.',
          subjectArea: 'National Aptitude & General Knowledge',
          questionBankKey: 'NATIONAL_SCHOLARS',
          status: 'LIVE',
          targetInstitutionTypes: [],
          allowedDepartments: [],
          allowedLevels: [],
          allowIndependentLearners: true,
          maxParticipantsPerSchool: 5,
          maxTotalParticipants: 300,
          requireAdminApproval: false,
          secondsPerQuestion: 20,
          maxTabSwitchesAllowed: 2,
          prizePoolText: 'National Scholar Crown + 500 XP',
          xpRewardFirst: 500,
          xpRewardSecond: 300,
          xpRewardThird: 200,
        },
      ];

      for (const seed of seeds) {
        const exists = await this.prisma.academicTournament.findUnique({
          where: { code: seed.code },
          select: { id: true },
        });
        if (exists) continue;

        const questions = resolveQuestionBank(seed.questionBankKey, seed.subjectArea);
        await this.prisma.academicTournament.create({
          data: {
            code: seed.code,
            title: seed.title,
            description: seed.description,
            subjectArea: seed.subjectArea,
            status: seed.status,
            targetInstitutionTypes: seed.targetInstitutionTypes,
            allowedDepartments: seed.allowedDepartments,
            allowedLevels: seed.allowedLevels,
            allowIndependentLearners: seed.allowIndependentLearners,
            maxParticipantsPerSchool: seed.maxParticipantsPerSchool,
            maxTotalParticipants: seed.maxTotalParticipants,
            requireAdminApproval: seed.requireAdminApproval,
            questionCount: questions.length,
            secondsPerQuestion: seed.secondsPerQuestion,
            maxTabSwitchesAllowed: seed.maxTabSwitchesAllowed,
            prizePoolText: seed.prizePoolText,
            xpRewardFirst: seed.xpRewardFirst,
            xpRewardSecond: seed.xpRewardSecond,
            xpRewardThird: seed.xpRewardThird,
            startsAt: new Date(),
            hostSchoolId: null,
            createdById: platformCreatorId,
            questions: {
              create: questions.map((q, idx) => ({
                orderIndex: idx,
                prompt: q.prompt,
                optionsJson: q.options,
                correctIndex: q.correctIndex,
                explanation: q.explanation,
                points: q.points,
                timeLimitSeconds: seed.secondsPerQuestion || q.timeLimitSeconds,
              })),
            },
            spectatorEvents: {
              create: {
                eventType: 'MILESTONE',
                emoji: '🏆',
                message: `${seed.title} is open for verified delegates and live spectators.`,
              },
            },
          },
        });
      }
    }

    this.bootstrapped = true;
  }

  private async loadUserWithProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        role: true,
        schoolId: true,
        avatarUrl: true,
        school: {
          select: {
            id: true,
            name: true,
            schoolCode: true,
            institutionType: true,
          },
        },
        studentProfile: {
          select: {
            level: true,
            academicStatus: true,
            matricOrAdmissionNo: true,
            department: { select: { name: true, code: true } },
            schoolClass: { select: { name: true, levelCode: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private buildEligibilityContext(
    user: Awaited<ReturnType<TournamentsService['loadUserWithProfile']>>,
  ): StudentEligibilityContext {
    return {
      role: user.role,
      schoolId: user.schoolId,
      schoolName: user.school?.name || null,
      institutionType: user.school?.institutionType || null,
      academicStatus: user.studentProfile?.academicStatus || 'ACTIVE',
      level: user.studentProfile?.level || null,
      className: user.studentProfile?.schoolClass?.name || null,
      classLevelCode: user.studentProfile?.schoolClass?.levelCode || null,
      departmentName: user.studentProfile?.department?.name || null,
      departmentCode: user.studentProfile?.department?.code || null,
      matricOrAdmissionNo: user.studentProfile?.matricOrAdmissionNo || null,
    };
  }

  private sanitizeArrayInput(items?: string[]): string[] {
    if (!Array.isArray(items)) return [];
    return items.map((s) => s.trim()).filter(Boolean);
  }

  private computeTournamentPermissions(
    user: Awaited<ReturnType<TournamentsService['loadUserWithProfile']>>,
    tournament: {
      status: string;
      hostSchoolId: string | null;
      createdById: string;
      targetInstitutionTypes: string[];
    },
    studentEligible?: boolean,
    hasStudentEntry?: boolean,
    explicitSchoolInstitutionType?: string | null,
  ): {
    isHost: boolean;
    isSchoolTypeEligible: boolean;
    canControlStatus: boolean;
    canManageSquad: boolean;
    isSpectatorOnly: boolean;
    spectatorReason: string | null;
  } {
    const isPlatformHosted = !tournament.hostSchoolId;
    const isHost =
      user.role === 'SUPER_ADMIN' ||
      (!isPlatformHosted &&
        (tournament.createdById === user.id ||
          (user.role === 'SCHOOL_ADMIN' && user.schoolId === tournament.hostSchoolId)));

    const canControlStatus = isHost;

    const effectiveInstType = String(
      explicitSchoolInstitutionType || user.school?.institutionType || '',
    )
      .trim()
      .toUpperCase();

    const targetTypes = (tournament.targetInstitutionTypes || []).map((t) =>
      t.trim().toUpperCase(),
    );

    const hasStaffSchool = Boolean(user.schoolId && STAFF_ROLES.has(user.role));
    const isSchoolTypeEligible =
      hasStaffSchool &&
      (targetTypes.length === 0 || (effectiveInstType !== '' && targetTypes.includes(effectiveInstType)));

    const isOpenOrLive =
      tournament.status !== 'COMPLETED' && tournament.status !== 'CANCELLED';

    const canManageSquad = Boolean(hasStaffSchool && isSchoolTypeEligible && isOpenOrLive);

    if (user.role === 'STUDENT') {
      const isSpectatorOnly = !studentEligible && !hasStudentEntry;
      return {
        isHost: false,
        isSchoolTypeEligible: false,
        canControlStatus: false,
        canManageSquad: false,
        isSpectatorOnly,
        spectatorReason: isSpectatorOnly
          ? 'Spectator View: Live standings and spectator stream only.'
          : null,
      };
    }

    const isSpectatorOnly = !canControlStatus && !canManageSquad;
    let spectatorReason: string | null = null;
    if (isSpectatorOnly) {
      if (!isSchoolTypeEligible && targetTypes.length > 0 && hasStaffSchool) {
        spectatorReason = `Spectator View: This Olympiad is exclusively for ${targetTypes.join(' / ')} institutions. Your school (${effectiveInstType || 'Unverified'}) can watch live standings and the spectator stream.`;
      } else if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
        spectatorReason = 'Spectator View: This Olympiad has concluded.';
      } else {
        spectatorReason = 'Spectator View: Live standings and spectator stream only.';
      }
    }

    return {
      isHost,
      isSchoolTypeEligible,
      canControlStatus,
      canManageSquad,
      isSpectatorOnly,
      spectatorReason,
    };
  }

  // ============================================================================
  // 1. HUB LISTING & DETAIL
  // ============================================================================

  async getHub(userId: string, explicitSchoolId?: string) {
    await this.ensureDefaultOlympiads(userId);

    const [user, explicitSchool] = await Promise.all([
      this.loadUserWithProfile(userId),
      explicitSchoolId
        ? this.prisma.school.findUnique({
            where: { id: explicitSchoolId },
            select: { institutionType: true },
          })
        : Promise.resolve(null),
    ]);
    const activeSchoolId = explicitSchoolId || user.schoolId || null;
    const studentCtx = this.buildEligibilityContext(user);

    const [tournaments, myEntries, schoolQuotaRows] = await Promise.all([
      this.prisma.academicTournament.findMany({
        orderBy: [{ createdAt: 'desc' }],
        include: {
          hostSchool: { select: { id: true, name: true, schoolCode: true } },
          _count: { select: { entries: true, questions: true } },
        },
      }),
      this.prisma.tournamentEntry.findMany({
        where: { userId },
        select: {
          id: true,
          tournamentId: true,
          status: true,
          totalScore: true,
          correctCount: true,
          answeredCount: true,
          tabSwitchCount: true,
          xpAwarded: true,
          registrationSource: true,
        },
      }),
      activeSchoolId
        ? this.prisma.tournamentEntry.groupBy({
            by: ['tournamentId'],
            where: {
              schoolId: activeSchoolId,
              status: { not: 'DISQUALIFIED' },
            },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const myEntryMap = new Map(myEntries.map((e) => [e.tournamentId, e]));
    const quotaMap = new Map(
      schoolQuotaRows.map((row) => [row.tournamentId, row._count.id]),
    );

    const enriched = tournaments.map((t) => {
      const eligibility: EligibilityEvaluationResult =
        user.role === 'STUDENT'
          ? evaluateStudentEligibility(
              {
                targetInstitutionTypes: t.targetInstitutionTypes,
                allowedDepartments: t.allowedDepartments,
                allowedLevels: t.allowedLevels,
                allowIndependentLearners: t.allowIndependentLearners,
              },
              studentCtx,
            )
          : {
              eligible: false,
              reasons: ['Staff & Admins oversee school nominations and live spectator streams.'],
              verifiedSnapshot: {
                institutionType: user.school?.institutionType || null,
                departmentName: null,
                levelOrClass: null,
                matricOrAdmissionNo: null,
              },
            };

      const myEntry = myEntryMap.get(t.id) || null;
      const permissions = this.computeTournamentPermissions(
        user,
        t,
        eligibility.eligible,
        Boolean(myEntry),
        explicitSchool?.institutionType || null,
      );
      const schoolSlotsUsed = quotaMap.get(t.id) || 0;
      return {
        id: t.id,
        code: t.code,
        title: t.title,
        description: t.description,
        subjectArea: t.subjectArea,
        status: t.status,
        targetInstitutionTypes: t.targetInstitutionTypes,
        allowedDepartments: t.allowedDepartments,
        allowedLevels: t.allowedLevels,
        allowIndependentLearners: t.allowIndependentLearners,
        maxParticipantsPerSchool: t.maxParticipantsPerSchool,
        maxTotalParticipants: t.maxTotalParticipants,
        requireAdminApproval: t.requireAdminApproval,
        questionCount: t._count.questions || t.questionCount,
        secondsPerQuestion: t.secondsPerQuestion,
        maxTabSwitchesAllowed: t.maxTabSwitchesAllowed,
        prizePoolText: t.prizePoolText,
        xpRewardFirst: t.xpRewardFirst,
        xpRewardSecond: t.xpRewardSecond,
        xpRewardThird: t.xpRewardThird,
        startsAt: t.startsAt,
        hostSchool: t.hostSchool,
        hostLabel: t.hostSchool
          ? `Hosted by ${t.hostSchool.name}`
          : 'National Platform Olympiad',
        createdById: t.createdById,
        participantsCount: t._count.entries,
        schoolSlotsUsed,
        viewerCount: this.gateway.getViewerCount(t.id),
        myEntry,
        myEligibility: eligibility,
        permissions: {
          isHost: permissions.isHost,
          canControlStatus: permissions.canControlStatus,
          canManageSquad: permissions.canManageSquad,
          isSpectatorOnly: permissions.isSpectatorOnly,
          spectatorReason: permissions.spectatorReason,
        },
      };
    });

    // Sort LIVE first, then REGISTRATION_OPEN, then others
    const orderRank: Record<string, number> = {
      LIVE: 0,
      REGISTRATION_OPEN: 1,
      DRAFT: 2,
      COMPLETED: 3,
      CANCELLED: 4,
    };
    enriched.sort((a, b) => (orderRank[a.status] ?? 9) - (orderRank[b.status] ?? 9));

    return {
      userProfileSummary: {
        role: user.role,
        schoolId: activeSchoolId,
        schoolName: user.school?.name || 'Independent Learner',
        institutionType: user.school?.institutionType || 'INDEPENDENT',
        departmentName: studentCtx.departmentName,
        levelOrClass: studentCtx.className || studentCtx.level,
      },
      tournaments: enriched,
    };
  }

  private buildLeaderboards(entries: Array<any>, totalQuestions: number) {
    // 1. Individual Leaderboard (Non-disqualified sorted by score DESC, time ASC; Disqualified last)
    const sortedEntries = [...entries].sort((a, b) => {
      const aDisq = a.status === 'DISQUALIFIED' ? 1 : 0;
      const bDisq = b.status === 'DISQUALIFIED' ? 1 : 0;
      if (aDisq !== bDisq) return aDisq - bDisq;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.totalResponseTimeMs - b.totalResponseTimeMs;
    });

    const leaderboard = sortedEntries.map((e, idx) => ({
      entryId: e.id,
      rank: e.status === 'DISQUALIFIED' ? null : idx + 1,
      userId: e.userId,
      fullName: e.user?.fullName || 'Scholar',
      avatarUrl: e.user?.avatarUrl || null,
      schoolId: e.schoolId,
      schoolName: e.school?.name || 'Independent Learner',
      schoolCode: e.school?.schoolCode || 'IND',
      verifiedDepartmentName: e.verifiedDepartmentName,
      verifiedLevelOrClass: e.verifiedLevelOrClass,
      verifiedMatricOrAdmissionNo: e.verifiedMatricOrAdmissionNo,
      status: e.status,
      totalScore: e.totalScore,
      correctCount: e.correctCount,
      answeredCount: e.answeredCount,
      totalQuestions,
      totalResponseTimeMs: e.totalResponseTimeMs,
      tabSwitchCount: e.tabSwitchCount,
      disqualificationReason: e.disqualificationReason,
      xpAwarded: e.xpAwarded,
      registrationSource: e.registrationSource,
    }));

    // 2. School vs School Trophy Standings
    const schoolMap = new Map<
      string,
      {
        schoolId: string | null;
        schoolName: string;
        schoolCode: string;
        totalScore: number;
        totalCorrect: number;
        totalAnswered: number;
        delegatesCount: number;
        completedCount: number;
        disqualifiedCount: number;
        topDelegateName: string | null;
        topDelegateScore: number;
      }
    >();

    for (const item of leaderboard) {
      const key = item.schoolId || 'INDEPENDENT';
      if (!schoolMap.has(key)) {
        schoolMap.set(key, {
          schoolId: item.schoolId,
          schoolName: item.schoolId ? item.schoolName : 'Independent Scholars',
          schoolCode: item.schoolId ? item.schoolCode : 'IND',
          totalScore: 0,
          totalCorrect: 0,
          totalAnswered: 0,
          delegatesCount: 0,
          completedCount: 0,
          disqualifiedCount: 0,
          topDelegateName: null,
          topDelegateScore: -1,
        });
      }
      const agg = schoolMap.get(key)!;
      agg.delegatesCount += 1;
      if (item.status === 'DISQUALIFIED') {
        agg.disqualifiedCount += 1;
      } else {
        agg.totalScore += item.totalScore;
        agg.totalCorrect += item.correctCount;
        agg.totalAnswered += item.answeredCount;
        if (item.status === 'COMPLETED') agg.completedCount += 1;
        if (item.totalScore > agg.topDelegateScore) {
          agg.topDelegateScore = item.totalScore;
          agg.topDelegateName = item.fullName;
        }
      }
    }

    const schoolStandings = Array.from(schoolMap.values())
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return b.totalCorrect - a.totalCorrect;
      })
      .map((s, idx) => ({
        ...s,
        rank: idx + 1,
        accuracyPercent:
          s.totalAnswered > 0 ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0,
      }));

    return { leaderboard, schoolStandings };
  }

  async getTournamentDetail(
    userId: string,
    tournamentId: string,
    explicitSchoolId?: string,
  ) {
    const [user, tournament] = await Promise.all([
      this.loadUserWithProfile(userId),
      this.prisma.academicTournament.findUnique({
        where: { id: tournamentId },
        include: {
          hostSchool: { select: { id: true, name: true, schoolCode: true } },
          _count: { select: { questions: true } },
          entries: {
            include: {
              user: { select: ENTRY_USER_SELECT },
              school: { select: { id: true, name: true, schoolCode: true } },
            },
          },
          spectatorEvents: {
            orderBy: { createdAt: 'desc' },
            take: 35,
            include: {
              user: { select: { id: true, fullName: true } },
              school: { select: { id: true, name: true, schoolCode: true } },
            },
          },
        },
      }),
    ]);

    if (!tournament) throw new NotFoundException('Olympiad tournament not found.');

    const activeSchoolId = explicitSchoolId || user.schoolId || null;
    const studentCtx = this.buildEligibilityContext(user);
    const totalQuestions = tournament._count.questions || tournament.questionCount;

    const myEligibility: EligibilityEvaluationResult =
      user.role === 'STUDENT'
        ? evaluateStudentEligibility(
            {
              targetInstitutionTypes: tournament.targetInstitutionTypes,
              allowedDepartments: tournament.allowedDepartments,
              allowedLevels: tournament.allowedLevels,
              allowIndependentLearners: tournament.allowIndependentLearners,
            },
            studentCtx,
          )
        : {
            eligible: false,
            reasons: ['Only Student accounts participate directly in live timed rounds.'],
            verifiedSnapshot: {
              institutionType: user.school?.institutionType || null,
              departmentName: null,
              levelOrClass: null,
              matricOrAdmissionNo: null,
            },
          };

    const myEntry = tournament.entries.find((e) => e.userId === userId) || null;

    const schoolQuotaUsed = activeSchoolId
      ? tournament.entries.filter(
          (e) => e.schoolId === activeSchoolId && e.status !== 'DISQUALIFIED',
        ).length
      : 0;

    const { leaderboard, schoolStandings } = this.buildLeaderboards(
      tournament.entries,
      totalQuestions,
    );

    const explicitSchool = explicitSchoolId
      ? await this.prisma.school.findUnique({
          where: { id: explicitSchoolId },
          select: { name: true, institutionType: true },
        })
      : null;

    const permissions = this.computeTournamentPermissions(
      user,
      tournament,
      myEligibility.eligible,
      Boolean(myEntry),
      explicitSchool?.institutionType || null,
    );

    return {
      tournament: {
        id: tournament.id,
        code: tournament.code,
        title: tournament.title,
        description: tournament.description,
        subjectArea: tournament.subjectArea,
        status: tournament.status,
        targetInstitutionTypes: tournament.targetInstitutionTypes,
        allowedDepartments: tournament.allowedDepartments,
        allowedLevels: tournament.allowedLevels,
        allowIndependentLearners: tournament.allowIndependentLearners,
        maxParticipantsPerSchool: tournament.maxParticipantsPerSchool,
        maxTotalParticipants: tournament.maxTotalParticipants,
        requireAdminApproval: tournament.requireAdminApproval,
        questionCount: totalQuestions,
        secondsPerQuestion: tournament.secondsPerQuestion,
        maxTabSwitchesAllowed: tournament.maxTabSwitchesAllowed,
        prizePoolText: tournament.prizePoolText,
        xpRewardFirst: tournament.xpRewardFirst,
        xpRewardSecond: tournament.xpRewardSecond,
        xpRewardThird: tournament.xpRewardThird,
        startsAt: tournament.startsAt,
        endsAt: tournament.endsAt,
        hostSchool: tournament.hostSchool,
        hostLabel: tournament.hostSchool
          ? `Hosted by ${tournament.hostSchool.name}`
          : 'National Platform Olympiad',
        createdById: tournament.createdById,
      },
      myEntry,
      myEligibility,
      permissions: {
        isHost: permissions.isHost,
        canControlStatus: permissions.canControlStatus,
        canManageSquad: permissions.canManageSquad,
        isSpectatorOnly: permissions.isSpectatorOnly,
        spectatorReason: permissions.spectatorReason,
      },
      schoolQuota: {
        schoolId: activeSchoolId,
        schoolName: explicitSchool?.name || user.school?.name || 'Independent',
        used: schoolQuotaUsed,
        max: tournament.maxParticipantsPerSchool,
      },
      viewerCount: this.gateway.getViewerCount(tournament.id),
      leaderboard,
      schoolStandings,
      spectatorFeed: tournament.spectatorEvents,
    };
  }

  // ============================================================================
  // 2. OLYMPIAD CREATION & STATUS CONTROL
  // ============================================================================

  async createTournament(
    userId: string,
    dto: CreateTournamentDto,
    explicitSchoolId?: string,
  ) {
    const user = await this.loadUserWithProfile(userId);
    if (!STAFF_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Only School Admins, Educators, or SuperAdmins can launch Olympiads.',
      );
    }

    const hostSchoolId = explicitSchoolId || user.schoolId || null;
    const questions =
      dto.questions && dto.questions.length > 0
        ? dto.questions.map((q) => ({
            prompt: q.prompt.trim(),
            options: q.options.map((o) => o.trim()),
            correctIndex: q.correctIndex,
            explanation: q.explanation?.trim() || '',
            points: q.points ?? 100,
            timeLimitSeconds: q.timeLimitSeconds ?? dto.secondsPerQuestion ?? 20,
          }))
        : resolveQuestionBank(dto.questionBankKey, dto.subjectArea);

    const secondsPerQ = dto.secondsPerQuestion ?? 20;

    const created = await this.prisma.academicTournament.create({
      data: {
        code: this.generateCode(dto.subjectArea),
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        subjectArea: dto.subjectArea.trim(),
        status: dto.status || 'REGISTRATION_OPEN',
        targetInstitutionTypes: this.sanitizeArrayInput(dto.targetInstitutionTypes).map((x) =>
          x.toUpperCase(),
        ),
        allowedDepartments: this.sanitizeArrayInput(dto.allowedDepartments),
        allowedLevels: this.sanitizeArrayInput(dto.allowedLevels),
        allowIndependentLearners: dto.allowIndependentLearners ?? false,
        maxParticipantsPerSchool: dto.maxParticipantsPerSchool ?? 3,
        maxTotalParticipants: dto.maxTotalParticipants ?? 100,
        requireAdminApproval: dto.requireAdminApproval ?? true,
        questionCount: questions.length,
        secondsPerQuestion: secondsPerQ,
        maxTabSwitchesAllowed: dto.maxTabSwitchesAllowed ?? 2,
        prizePoolText: dto.prizePoolText?.trim() || '500 XP + Olympiad Crown',
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        hostSchoolId,
        createdById: userId,
        questions: {
          create: questions.map((q, idx) => ({
            orderIndex: idx,
            prompt: q.prompt,
            optionsJson: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            points: q.points,
            timeLimitSeconds: secondsPerQ,
          })),
        },
        spectatorEvents: {
          create: {
            userId,
            schoolId: hostSchoolId,
            eventType: 'MILESTONE',
            emoji: '🎯',
            message: `${dto.title.trim()} was launched by ${user.fullName || 'Olympiad Coordinator'}.`,
          },
        },
      },
      include: {
        hostSchool: { select: { id: true, name: true, schoolCode: true } },
      },
    });

    return created;
  }

  async updateTournamentStatus(
    actorId: string,
    tournamentId: string,
    status: 'DRAFT' | 'REGISTRATION_OPEN' | 'LIVE' | 'COMPLETED' | 'CANCELLED',
  ) {
    const [actor, tournament] = await Promise.all([
      this.loadUserWithProfile(actorId),
      this.prisma.academicTournament.findUnique({
        where: { id: tournamentId },
        include: {
          entries: {
            include: { user: { select: { id: true, fullName: true } } },
          },
        },
      }),
    ]);

    if (!tournament) throw new NotFoundException('Tournament not found.');
    const permissions = this.computeTournamentPermissions(actor, tournament);
    if (!permissions.canControlStatus) {
      throw new ForbiddenException(
        'Only the Olympiad host/organizer or Platform SuperAdmin can start, finalize, or cancel this Olympiad.',
      );
    }

    if (status === 'COMPLETED') {
      const competedCount = tournament.entries.filter(
        (e) => e.status !== 'DISQUALIFIED' && e.answeredCount > 0,
      ).length;
      if (competedCount === 0) {
        throw new BadRequestException(
          'No delegates have competed yet. Use Cancel Olympiad to close an empty event.',
        );
      }
    }

    const updated = await this.prisma.academicTournament.update({
      where: { id: tournamentId },
      data: {
        status,
        ...(status === 'LIVE' ? { startsAt: new Date() } : {}),
        ...(status === 'COMPLETED' ? { endsAt: new Date() } : {}),
      },
    });

    const eventMessage =
      status === 'LIVE'
        ? `🚨 ${tournament.title} is NOW LIVE! Delegates can enter the timed arena.`
        : status === 'COMPLETED'
          ? `🏁 ${tournament.title} has concluded! Official podium rankings & XP awards finalized.`
          : `Status changed to ${status}.`;

    const feedEvent = await this.prisma.tournamentSpectatorEvent.create({
      data: {
        tournamentId,
        userId: actorId,
        schoolId: actor.schoolId,
        eventType: 'MILESTONE',
        emoji: status === 'LIVE' ? '🔥' : status === 'COMPLETED' ? '🏆' : '📣',
        message: eventMessage,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        school: { select: { id: true, name: true, schoolCode: true } },
      },
    });

    this.gateway.emitStatusChange(tournamentId, status);
    this.gateway.emitFeedEvent(tournamentId, feedEvent);

    // Notify delegates when going LIVE or award top 3 XP when COMPLETED
    if (status === 'LIVE') {
      const delegates = tournament.entries.filter((e) => e.status === 'REGISTERED');
      for (const entry of delegates) {
        void this.notifications
          .dispatchNotification({
            userId: entry.userId,
            schoolId: entry.schoolId || undefined,
            title: `🚨 Olympiad LIVE Now: ${tournament.title}`,
            body: 'Your school delegation arena is open! Tap to launch your timed attempt.',
            category: 'GAMES',
            deepLink: `/tournaments?id=${tournamentId}`,
            dataJson: { tournamentId },
            channels: { inApp: true, push: true, email: false },
          })
          .catch(() => {});
      }
    } else if (status === 'COMPLETED') {
      const qualified = tournament.entries
        .filter((e) => e.status !== 'DISQUALIFIED' && e.answeredCount > 0)
        .sort((a, b) =>
          b.totalScore !== a.totalScore
            ? b.totalScore - a.totalScore
            : a.totalResponseTimeMs - b.totalResponseTimeMs,
        );

      const rewards = [
        tournament.xpRewardFirst,
        tournament.xpRewardSecond,
        tournament.xpRewardThird,
      ];

      for (let i = 0; i < Math.min(3, qualified.length); i++) {
        const winner = qualified[i];
        const bonusXp = rewards[i] || 100;
        if (winner.xpAwarded > 0) continue;

        await this.prisma.$transaction([
          this.prisma.tournamentEntry.update({
            where: { id: winner.id },
            data: { xpAwarded: bonusXp },
          }),
          this.prisma.user.update({
            where: { id: winner.userId },
            data: { xpPoints: { increment: bonusXp } },
          }),
        ]);

        const medal = i === 0 ? '🥇 1st Place' : i === 1 ? '🥈 2nd Place' : '🥉 3rd Place';
        void this.notifications
          .dispatchNotification({
            userId: winner.userId,
            schoolId: winner.schoolId || undefined,
            title: `${medal} in ${tournament.title}! 🏆`,
            body: `You earned +${bonusXp} bonus XP (${winner.totalScore} pts). Tap to view the final podium!`,
            category: 'GAMES',
            deepLink: `/tournaments?id=${tournamentId}`,
            dataJson: { tournamentId, rank: i + 1 },
            channels: { inApp: true, push: true, email: false },
          })
          .catch(() => {});
      }
    }

    return updated;
  }

  // ============================================================================
  // 3. SCHOOL ADMIN SQUAD ROSTER, QUOTA ENFORCEMENT & ANTI-CHEAT VALIDATION
  // ============================================================================

  async getSchoolRosterForTournament(
    actorId: string,
    tournamentId: string,
    explicitSchoolId?: string,
  ) {
    const actor = await this.loadUserWithProfile(actorId);
    if (!STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException('Only School Admins or Educators can manage school delegations.');
    }

    const schoolId = explicitSchoolId || actor.schoolId;
    if (!schoolId) {
      throw new BadRequestException('Select or belong to a school institution first.');
    }

    const [tournament, school, students, existingEntries] = await Promise.all([
      this.prisma.academicTournament.findUnique({ where: { id: tournamentId } }),
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, schoolCode: true, institutionType: true },
      }),
      this.prisma.user.findMany({
        where: { schoolId, role: 'STUDENT' },
        orderBy: [{ fullName: 'asc' }],
        take: 150,
        select: {
          id: true,
          fullName: true,
          email: true,
          loginId: true,
          avatarUrl: true,
          studentProfile: {
            select: {
              level: true,
              academicStatus: true,
              matricOrAdmissionNo: true,
              department: { select: { name: true, code: true } },
              schoolClass: { select: { name: true, levelCode: true } },
            },
          },
        },
      }),
      this.prisma.tournamentEntry.findMany({
        where: { tournamentId, schoolId },
        select: {
          id: true,
          userId: true,
          status: true,
          totalScore: true,
          tabSwitchCount: true,
          registrationSource: true,
        },
      }),
    ]);

    if (!tournament || !school) {
      throw new NotFoundException('Tournament or school not found.');
    }

    const rosterPerms = this.computeTournamentPermissions(
      actor,
      tournament,
      false,
      false,
      school.institutionType,
    );
    if (!rosterPerms.isSchoolTypeEligible) {
      throw new ForbiddenException(
        'Your school institution type is not eligible for this Olympiad. Spectator view only.',
      );
    }

    const entryByUserId = new Map(existingEntries.map((e) => [e.userId, e]));
    const activeUsed = existingEntries.filter((e) => e.status !== 'DISQUALIFIED').length;

    const roster = students.map((st) => {
      const eligibility = evaluateStudentEligibility(
        {
          targetInstitutionTypes: tournament.targetInstitutionTypes,
          allowedDepartments: tournament.allowedDepartments,
          allowedLevels: tournament.allowedLevels,
          allowIndependentLearners: tournament.allowIndependentLearners,
        },
        {
          role: 'STUDENT',
          schoolId,
          schoolName: school.name,
          institutionType: school.institutionType,
          academicStatus: st.studentProfile?.academicStatus || 'ACTIVE',
          level: st.studentProfile?.level || null,
          className: st.studentProfile?.schoolClass?.name || null,
          classLevelCode: st.studentProfile?.schoolClass?.levelCode || null,
          departmentName: st.studentProfile?.department?.name || null,
          departmentCode: st.studentProfile?.department?.code || null,
          matricOrAdmissionNo: st.studentProfile?.matricOrAdmissionNo || null,
        },
      );

      return {
        studentId: st.id,
        fullName: st.fullName || st.loginId || 'Student',
        loginId: st.loginId,
        avatarUrl: st.avatarUrl,
        departmentName: eligibility.verifiedSnapshot.departmentName,
        levelOrClass: eligibility.verifiedSnapshot.levelOrClass,
        matricOrAdmissionNo: eligibility.verifiedSnapshot.matricOrAdmissionNo,
        eligibility,
        entry: entryByUserId.get(st.id) || null,
      };
    });

    const pendingRequests = roster.filter((r) => r.entry?.status === 'PENDING_APPROVAL');

    return {
      schoolQuota: {
        schoolId,
        schoolName: school.name,
        used: activeUsed,
        max: tournament.maxParticipantsPerSchool,
      },
      pendingRequests,
      roster,
    };
  }

  async adminRegisterStudents(
    actorId: string,
    tournamentId: string,
    dto: AdminRegisterStudentsDto,
    explicitSchoolId?: string,
  ) {
    const actor = await this.loadUserWithProfile(actorId);
    if (!STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException('Only School Admins or Educators can register school squads.');
    }

    const schoolId = explicitSchoolId || actor.schoolId;
    if (!schoolId) {
      throw new BadRequestException('School context is required to register a school squad.');
    }

    const uniqueStudentIds = Array.from(new Set(dto.studentIds.filter(Boolean)));
    if (uniqueStudentIds.length === 0) {
      throw new BadRequestException('Select at least one student to register.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [tournament, school, targetStudents, existingSchoolEntries, totalEntriesCount] =
        await Promise.all([
          tx.academicTournament.findUnique({ where: { id: tournamentId } }),
          tx.school.findUnique({
            where: { id: schoolId },
            select: { id: true, name: true, schoolCode: true, institutionType: true },
          }),
          tx.user.findMany({
            where: { id: { in: uniqueStudentIds }, schoolId, role: 'STUDENT' },
            include: {
              studentProfile: {
                select: {
                  level: true,
                  academicStatus: true,
                  matricOrAdmissionNo: true,
                  department: { select: { name: true, code: true } },
                  schoolClass: { select: { name: true, levelCode: true } },
                },
              },
            },
          }),
          tx.tournamentEntry.findMany({
            where: { tournamentId, schoolId, status: { not: 'DISQUALIFIED' } },
            select: { userId: true, status: true },
          }),
          tx.tournamentEntry.count({
            where: { tournamentId, status: { not: 'DISQUALIFIED' } },
          }),
        ]);

      if (!tournament || !school) {
        throw new NotFoundException('Tournament or school not found.');
      }
      const squadPerms = this.computeTournamentPermissions(
        actor,
        tournament,
        false,
        false,
        school.institutionType,
      );
      if (!squadPerms.isSchoolTypeEligible) {
        throw new ForbiddenException(
          'Your school institution type is not eligible for this Olympiad. Spectator view only.',
        );
      }
      if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
        throw new BadRequestException('Registration is closed for this Olympiad.');
      }
      if (targetStudents.length !== uniqueStudentIds.length) {
        throw new ForbiddenException(
          'One or more selected users do not belong to your institution as active students.',
        );
      }

      const alreadyRegisteredIds = new Set(
        existingSchoolEntries
          .filter((e) => e.status !== 'PENDING_APPROVAL')
          .map((e) => e.userId),
      );
      const pendingIds = new Set(
        existingSchoolEntries
          .filter((e) => e.status === 'PENDING_APPROVAL')
          .map((e) => e.userId),
      );

      let newQuotaSlotsNeeded = 0;
      for (const id of uniqueStudentIds) {
        if (!alreadyRegisteredIds.has(id) && !pendingIds.has(id)) {
          newQuotaSlotsNeeded += 1;
        }
      }

      if (existingSchoolEntries.length + newQuotaSlotsNeeded > tournament.maxParticipantsPerSchool) {
        throw new BadRequestException(
          `School quota exceeded! Maximum ${tournament.maxParticipantsPerSchool} delegates allowed per school (${existingSchoolEntries.length} currently occupied).`,
        );
      }

      if (totalEntriesCount + newQuotaSlotsNeeded > tournament.maxTotalParticipants) {
        throw new BadRequestException('Tournament overall participant capacity has been reached.');
      }

      // Strictly verify Department & Level rules for EVERY student
      const verifiedRows: Array<{
        student: (typeof targetStudents)[number];
        snapshot: EligibilityEvaluationResult['verifiedSnapshot'];
      }> = [];

      for (const st of targetStudents) {
        const evalRes = evaluateStudentEligibility(
          {
            targetInstitutionTypes: tournament.targetInstitutionTypes,
            allowedDepartments: tournament.allowedDepartments,
            allowedLevels: tournament.allowedLevels,
            allowIndependentLearners: tournament.allowIndependentLearners,
          },
          {
            role: 'STUDENT',
            schoolId,
            schoolName: school.name,
            institutionType: school.institutionType,
            academicStatus: st.studentProfile?.academicStatus || 'ACTIVE',
            level: st.studentProfile?.level || null,
            className: st.studentProfile?.schoolClass?.name || null,
            classLevelCode: st.studentProfile?.schoolClass?.levelCode || null,
            departmentName: st.studentProfile?.department?.name || null,
            departmentCode: st.studentProfile?.department?.code || null,
            matricOrAdmissionNo: st.studentProfile?.matricOrAdmissionNo || null,
          },
        );

        if (!evalRes.eligible) {
          throw new ForbiddenException(
            `Anti-Cheat Verification Failed for ${st.fullName || st.loginId}: ${evalRes.reasons.join(' ')}`,
          );
        }
        verifiedRows.push({ student: st, snapshot: evalRes.verifiedSnapshot });
      }

      const createdEntries = [];
      for (const row of verifiedRows) {
        const entry = await tx.tournamentEntry.upsert({
          where: { tournamentId_userId: { tournamentId, userId: row.student.id } },
          update: {
            status: 'REGISTERED',
            registeredById: actorId,
            registrationSource: 'ADMIN_NOMINATED',
            verifiedInstitutionType: row.snapshot.institutionType,
            verifiedDepartmentName: row.snapshot.departmentName,
            verifiedLevelOrClass: row.snapshot.levelOrClass,
            verifiedMatricOrAdmissionNo: row.snapshot.matricOrAdmissionNo,
          },
          create: {
            tournamentId,
            userId: row.student.id,
            schoolId,
            registeredById: actorId,
            registrationSource: 'ADMIN_NOMINATED',
            status: 'REGISTERED',
            verifiedInstitutionType: row.snapshot.institutionType,
            verifiedDepartmentName: row.snapshot.departmentName,
            verifiedLevelOrClass: row.snapshot.levelOrClass,
            verifiedMatricOrAdmissionNo: row.snapshot.matricOrAdmissionNo,
          },
        });
        createdEntries.push({ entry, studentName: row.student.fullName });
      }

      const feedEvent = await tx.tournamentSpectatorEvent.create({
        data: {
          tournamentId,
          userId: actorId,
          schoolId,
          eventType: 'MILESTONE',
          emoji: '🏫',
          message: `${school.name} (${school.schoolCode}) confirmed ${verifiedRows.length} verified delegate${verifiedRows.length > 1 ? 's' : ''}: ${verifiedRows.map((v) => v.student.fullName).join(', ')}.`,
        },
        include: {
          user: { select: { id: true, fullName: true } },
          school: { select: { id: true, name: true, schoolCode: true } },
        },
      });

      return { tournament, school, createdEntries, feedEvent };
    });

    this.gateway.emitFeedEvent(tournamentId, result.feedEvent);
    this.gateway.emitStandingsUpdate(tournamentId, { updatedAt: new Date().toISOString() });

    for (const item of result.createdEntries) {
      void this.notifications
        .dispatchNotification({
          userId: item.entry.userId,
          schoolId,
          title: `Nominated for ${result.tournament.title}! 🏆`,
          body: `${result.school.name} selected you to represent the school. Tap to enter the Olympiad Arena!`,
          category: 'GAMES',
          deepLink: `/tournaments?id=${tournamentId}`,
          dataJson: { tournamentId },
          channels: { inApp: true, push: true, email: false },
        })
        .catch(() => {});
    }

    return {
      registeredCount: result.createdEntries.length,
      entries: result.createdEntries.map((c) => c.entry),
    };
  }

  async approveEntry(actorId: string, tournamentId: string, entryId: string) {
    const [actor, entry] = await Promise.all([
      this.loadUserWithProfile(actorId),
      this.prisma.tournamentEntry.findUnique({
        where: { id: entryId },
        include: { tournament: true, user: { select: { id: true, fullName: true } } },
      }),
    ]);

    if (!entry || entry.tournamentId !== tournamentId) {
      throw new NotFoundException('Tournament entry not found.');
    }
    if (!STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException('Only School Admins or Educators can approve delegates.');
    }
    const approvePerms = this.computeTournamentPermissions(actor, entry.tournament);
    if (!approvePerms.isSchoolTypeEligible && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Your school institution type is not eligible for this Olympiad. Spectator view only.',
      );
    }
    if (actor.role !== 'SUPER_ADMIN' && actor.schoolId !== entry.schoolId) {
      throw new ForbiddenException('You can only approve delegates from your own school.');
    }

    if (entry.schoolId) {
      const approvedCount = await this.prisma.tournamentEntry.count({
        where: {
          tournamentId,
          schoolId: entry.schoolId,
          status: { in: ['REGISTERED', 'PLAYING', 'COMPLETED'] },
        },
      });
      if (approvedCount >= entry.tournament.maxParticipantsPerSchool) {
        throw new BadRequestException(
          `School quota (${entry.tournament.maxParticipantsPerSchool} delegates) is already full.`,
        );
      }
    }

    const updated = await this.prisma.tournamentEntry.update({
      where: { id: entryId },
      data: {
        status: 'REGISTERED',
        registeredById: actorId,
      },
    });

    this.gateway.emitStandingsUpdate(tournamentId, { updatedAt: new Date().toISOString() });

    void this.notifications
      .dispatchNotification({
        userId: entry.userId,
        schoolId: entry.schoolId || undefined,
        title: `Olympiad Spot Approved! ✅`,
        body: `Your request to represent your school in "${entry.tournament.title}" has been approved!`,
        category: 'GAMES',
        deepLink: `/tournaments?id=${tournamentId}`,
        dataJson: { tournamentId },
        channels: { inApp: true, push: true, email: false },
      })
      .catch(() => {});

    return updated;
  }

  async withdrawEntry(actorId: string, tournamentId: string, entryId: string) {
    const [actor, entry] = await Promise.all([
      this.loadUserWithProfile(actorId),
      this.prisma.tournamentEntry.findUnique({ where: { id: entryId } }),
    ]);

    if (!entry || entry.tournamentId !== tournamentId) {
      throw new NotFoundException('Tournament entry not found.');
    }
    const isSelf = entry.userId === actorId;
    const isSchoolStaff =
      STAFF_ROLES.has(actor.role) &&
      (actor.role === 'SUPER_ADMIN' || actor.schoolId === entry.schoolId);

    if (!isSelf && !isSchoolStaff) {
      throw new ForbiddenException('Not authorized to remove this entry.');
    }
    if (entry.status === 'COMPLETED' || entry.status === 'PLAYING') {
      throw new BadRequestException('Cannot withdraw a delegate who has already started competing.');
    }

    await this.prisma.tournamentEntry.delete({ where: { id: entryId } });
    this.gateway.emitStandingsUpdate(tournamentId, { updatedAt: new Date().toISOString() });
    return { removed: true, entryId };
  }

  async studentJoinTournament(userId: string, tournamentId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [user, tournament] = await Promise.all([
        this.loadUserWithProfile(userId),
        tx.academicTournament.findUnique({ where: { id: tournamentId } }),
      ]);

      if (!tournament) throw new NotFoundException('Tournament not found.');
      if (tournament.status !== 'REGISTRATION_OPEN' && tournament.status !== 'LIVE') {
        throw new BadRequestException('This Olympiad is not currently accepting registrations.');
      }

      const existing = await tx.tournamentEntry.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      });
      if (existing) return { entry: existing, created: false, user, tournament };

      const evalRes = evaluateStudentEligibility(
        {
          targetInstitutionTypes: tournament.targetInstitutionTypes,
          allowedDepartments: tournament.allowedDepartments,
          allowedLevels: tournament.allowedLevels,
          allowIndependentLearners: tournament.allowIndependentLearners,
        },
        this.buildEligibilityContext(user),
      );

      if (!evalRes.eligible) {
        throw new ForbiddenException(
          `Eligibility Check Failed: ${evalRes.reasons.join(' ')}`,
        );
      }

      const [schoolEntriesCount, totalEntriesCount] = await Promise.all([
        user.schoolId
          ? tx.tournamentEntry.count({
              where: {
                tournamentId,
                schoolId: user.schoolId,
                status: { not: 'DISQUALIFIED' },
              },
            })
          : Promise.resolve(0),
        tx.tournamentEntry.count({
          where: { tournamentId, status: { not: 'DISQUALIFIED' } },
        }),
      ]);

      if (user.schoolId && schoolEntriesCount >= tournament.maxParticipantsPerSchool) {
        throw new BadRequestException(
          `Your school has already filled its quota of ${tournament.maxParticipantsPerSchool} delegates for this Olympiad.`,
        );
      }
      if (totalEntriesCount >= tournament.maxTotalParticipants) {
        throw new BadRequestException('This Olympiad is currently at full capacity.');
      }

      const needsApproval = Boolean(user.schoolId && tournament.requireAdminApproval);
      const entryStatus = needsApproval ? 'PENDING_APPROVAL' : 'REGISTERED';

      const entry = await tx.tournamentEntry.create({
        data: {
          tournamentId,
          userId,
          schoolId: user.schoolId,
          registrationSource: 'SELF_JOIN',
          status: entryStatus,
          verifiedInstitutionType: evalRes.verifiedSnapshot.institutionType,
          verifiedDepartmentName: evalRes.verifiedSnapshot.departmentName,
          verifiedLevelOrClass: evalRes.verifiedSnapshot.levelOrClass,
          verifiedMatricOrAdmissionNo: evalRes.verifiedSnapshot.matricOrAdmissionNo,
        },
      });

      const feedEvent =
        entryStatus === 'REGISTERED'
          ? await tx.tournamentSpectatorEvent.create({
              data: {
                tournamentId,
                userId,
                schoolId: user.schoolId,
                eventType: 'MILESTONE',
                emoji: '🎓',
                message: `${user.fullName || 'Scholar'} (${user.school?.schoolCode || 'IND'} • ${evalRes.verifiedSnapshot.levelOrClass || 'Verified'}) entered the Olympiad!`,
              },
              include: {
                user: { select: { id: true, fullName: true } },
                school: { select: { id: true, name: true, schoolCode: true } },
              },
            })
          : null;

      return { entry, created: true, user, tournament, feedEvent };
    });

    if (result.created) {
      if (result.feedEvent) {
        this.gateway.emitFeedEvent(tournamentId, result.feedEvent);
      }
      this.gateway.emitStandingsUpdate(tournamentId, { updatedAt: new Date().toISOString() });

      if (result.entry.status === 'PENDING_APPROVAL' && result.user.schoolId) {
        const admins = await this.prisma.user.findMany({
          where: { schoolId: result.user.schoolId, role: { in: ['SCHOOL_ADMIN', 'TEACHER'] } },
          select: { id: true },
          take: 10,
        });
        for (const admin of admins) {
          void this.notifications
            .dispatchNotification({
              userId: admin.id,
              schoolId: result.user.schoolId,
              title: `Olympiad Spot Request: ${result.user.fullName}`,
              body: `Requested to represent ${result.user.school?.name || 'your school'} in ${result.tournament.title}. Tap to approve or reject.`,
              category: 'GAMES',
              deepLink: `/tournaments?id=${tournamentId}`,
              dataJson: { tournamentId },
              channels: { inApp: true, push: true, email: false },
            })
            .catch(() => {});
        }
      }
    }

    return result.entry;
  }

  // ============================================================================
  // 4. TIMED LIVE OLYMPIAD EXECUTION & REAL-TIME ANTI-CHEAT MONITOR
  // ============================================================================

  async startAttempt(userId: string, tournamentId: string) {
    const [tournament, entry] = await Promise.all([
      this.prisma.academicTournament.findUnique({
        where: { id: tournamentId },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              orderIndex: true,
              prompt: true,
              optionsJson: true,
              points: true,
              timeLimitSeconds: true,
            },
          },
        },
      }),
      this.prisma.tournamentEntry.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      }),
    ]);

    if (!tournament) throw new NotFoundException('Olympiad not found.');
    if (tournament.status !== 'LIVE') {
      throw new BadRequestException(
        `Olympiad arena is not live yet (status: ${tournament.status}).`,
      );
    }
    if (!entry) {
      throw new ForbiddenException('You must be registered as a verified delegate first.');
    }
    if (entry.status === 'PENDING_APPROVAL') {
      throw new ForbiddenException('Waiting for your School Admin to approve your slot.');
    }
    if (entry.status === 'DISQUALIFIED') {
      throw new ForbiddenException(
        entry.disqualificationReason || 'You have been disqualified due to anti-cheat violations.',
      );
    }
    if (entry.status === 'COMPLETED' || entry.currentQuestionIndex >= tournament.questions.length) {
      throw new BadRequestException('You have already completed all questions in this Olympiad.');
    }

    const updated = await this.prisma.tournamentEntry.update({
      where: { id: entry.id },
      data: {
        status: 'PLAYING',
        startedAt: entry.startedAt || new Date(),
      },
    });

    return {
      entryId: updated.id,
      tournamentId: tournament.id,
      tournamentTitle: tournament.title,
      secondsPerQuestion: tournament.secondsPerQuestion,
      maxTabSwitchesAllowed: tournament.maxTabSwitchesAllowed,
      currentQuestionIndex: updated.currentQuestionIndex,
      totalScore: updated.totalScore,
      tabSwitchCount: updated.tabSwitchCount,
      questions: tournament.questions.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        prompt: q.prompt,
        options: Array.isArray(q.optionsJson) ? (q.optionsJson as string[]) : [],
        points: q.points,
        timeLimitSeconds: q.timeLimitSeconds || tournament.secondsPerQuestion,
      })),
    };
  }

  async submitAnswer(
    userId: string,
    tournamentId: string,
    dto: SubmitTournamentAnswerDto,
  ) {
    const [tournament, entry, questions, user] = await Promise.all([
      this.prisma.academicTournament.findUnique({ where: { id: tournamentId } }),
      this.prisma.tournamentEntry.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
        include: { school: { select: { schoolCode: true } } },
      }),
      this.prisma.tournamentQuestion.findMany({
        where: { tournamentId },
        orderBy: { orderIndex: 'asc' },
      }),
      this.loadUserWithProfile(userId),
    ]);

    if (!tournament || !entry) throw new NotFoundException('Olympiad entry not found.');
    if (tournament.status !== 'LIVE') {
      throw new BadRequestException('Olympiad is no longer live.');
    }
    if (entry.status === 'DISQUALIFIED') {
      throw new ForbiddenException('Disqualified entries cannot submit answers.');
    }
    if (entry.status === 'COMPLETED') {
      throw new BadRequestException('Olympiad attempt already completed.');
    }

    const expectedQuestion = questions[entry.currentQuestionIndex];
    if (!expectedQuestion || expectedQuestion.id !== dto.questionId) {
      throw new BadRequestException(
        'Question mismatch or duplicate submission detected by anti-cheat guard.',
      );
    }

    const clampedTimeMs = Math.max(
      200,
      Math.min(dto.responseTimeMs, (expectedQuestion.timeLimitSeconds || 20) * 1000),
    );
    const isCorrect =
      dto.selectedIndex >= 0 && dto.selectedIndex === expectedQuestion.correctIndex;

    const maxTimeMs = (expectedQuestion.timeLimitSeconds || 20) * 1000;
    const speedRatio = Math.max(0, 1 - clampedTimeMs / maxTimeMs);
    const speedBonus = isCorrect ? Math.round(speedRatio * 50) : 0;
    const pointsEarned = isCorrect ? expectedQuestion.points + speedBonus : 0;

    const prevAnswers: StoredAnswerItem[] = Array.isArray(entry.answersJson)
      ? (entry.answersJson as unknown as StoredAnswerItem[])
      : [];
    const nextAnswers: StoredAnswerItem[] = [
      ...prevAnswers,
      {
        questionId: expectedQuestion.id,
        orderIndex: expectedQuestion.orderIndex,
        selectedIndex: dto.selectedIndex,
        isCorrect,
        pointsEarned,
        responseTimeMs: clampedTimeMs,
      },
    ];

    const flags: Array<Record<string, unknown>> = Array.isArray(entry.antiCheatFlagsJson)
      ? (entry.antiCheatFlagsJson as Array<Record<string, unknown>>)
      : [];
    if (dto.selectedIndex >= 0 && dto.responseTimeMs < 300) {
      flags.push({
        type: 'SUSPICIOUS_TIMING',
        questionIndex: expectedQuestion.orderIndex,
        responseTimeMs: dto.responseTimeMs,
        at: new Date().toISOString(),
      });
    }

    const nextIndex = entry.currentQuestionIndex + 1;
    const isFinished = nextIndex >= questions.length;
    const baseFinishXp = isFinished ? 50 : 0;

    const updated = await this.prisma.tournamentEntry.update({
      where: { id: entry.id },
      data: {
        currentQuestionIndex: nextIndex,
        totalScore: { increment: pointsEarned },
        correctCount: { increment: isCorrect ? 1 : 0 },
        answeredCount: { increment: 1 },
        totalResponseTimeMs: { increment: clampedTimeMs },
        answersJson: nextAnswers as any,
        antiCheatFlagsJson: flags as any,
        ...(isFinished
          ? {
              status: 'COMPLETED',
              completedAt: new Date(),
              xpAwarded: entry.xpAwarded > 0 ? entry.xpAwarded : baseFinishXp,
            }
          : { status: 'PLAYING' }),
      },
    });

    if (isFinished && entry.xpAwarded === 0) {
      await this.prisma.user
        .update({ where: { id: userId }, data: { xpPoints: { increment: baseFinishXp } } })
        .catch(() => {});
    }

    // Live Spectator Commentary
    let feedEvent: unknown = null;
    if (isFinished || isCorrect) {
      const schoolTag = entry.school?.schoolCode || 'IND';
      const msg = isFinished
        ? `🏁 ${user.fullName} (${schoolTag}) finished all ${questions.length} questions with ${updated.totalScore} pts!`
        : `⚡ ${user.fullName} (${schoolTag}) nailed Q${expectedQuestion.orderIndex + 1} (+${pointsEarned} pts)!`;
      feedEvent = await this.prisma.tournamentSpectatorEvent.create({
        data: {
          tournamentId,
          userId,
          schoolId: entry.schoolId,
          eventType: isFinished ? 'MILESTONE' : 'COMMENTARY',
          emoji: isFinished ? '🏁' : '⚡',
          message: msg,
        },
        include: {
          user: { select: { id: true, fullName: true } },
          school: { select: { id: true, name: true, schoolCode: true } },
        },
      });
    }

    if (feedEvent) {
      this.gateway.emitFeedEvent(tournamentId, feedEvent);
    }
    this.gateway.emitStandingsUpdate(tournamentId, {
      updatedAt: new Date().toISOString(),
      lastActorId: userId,
    });

    return {
      isCorrect,
      correctIndex: expectedQuestion.correctIndex,
      explanation: expectedQuestion.explanation,
      pointsEarned,
      speedBonus,
      totalScore: updated.totalScore,
      correctCount: updated.correctCount,
      currentQuestionIndex: updated.currentQuestionIndex,
      completed: isFinished,
      xpEarned: isFinished ? baseFinishXp : 0,
    };
  }

  async reportAntiCheatEvent(
    userId: string,
    tournamentId: string,
    dto: ReportAntiCheatEventDto,
  ) {
    const [tournament, entry, user] = await Promise.all([
      this.prisma.academicTournament.findUnique({ where: { id: tournamentId } }),
      this.prisma.tournamentEntry.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
        include: { school: { select: { schoolCode: true } } },
      }),
      this.loadUserWithProfile(userId),
    ]);

    if (!tournament || !entry) throw new NotFoundException('Olympiad entry not found.');
    if (entry.status !== 'PLAYING') {
      return {
        disqualified: entry.status === 'DISQUALIFIED',
        tabSwitchCount: entry.tabSwitchCount,
        maxAllowed: tournament.maxTabSwitchesAllowed,
      };
    }

    const nextStrikes = entry.tabSwitchCount + 1;
    const prevFlags: Array<Record<string, unknown>> = Array.isArray(entry.antiCheatFlagsJson)
      ? (entry.antiCheatFlagsJson as Array<Record<string, unknown>>)
      : [];
    const nextFlags = [
      ...prevFlags,
      {
        type: dto.eventType,
        detail: dto.detail || 'Left Olympiad screen during live timed round',
        strikeNumber: nextStrikes,
        at: new Date().toISOString(),
      },
    ];

    const exceeded = nextStrikes > tournament.maxTabSwitchesAllowed;
    const disqualificationReason = exceeded
      ? `Exceeded maximum allowed app/tab switches (${nextStrikes}/${tournament.maxTabSwitchesAllowed}) during live Olympiad.`
      : null;

    await this.prisma.tournamentEntry.update({
      where: { id: entry.id },
      data: {
        tabSwitchCount: nextStrikes,
        antiCheatFlagsJson: nextFlags as any,
        ...(exceeded
          ? {
              status: 'DISQUALIFIED',
              disqualificationReason,
              completedAt: new Date(),
            }
          : {}),
      },
    });

    const schoolTag = entry.school?.schoolCode || 'IND';
    const feedEvent = await this.prisma.tournamentSpectatorEvent.create({
      data: {
        tournamentId,
        userId,
        schoolId: entry.schoolId,
        eventType: 'VIOLATION',
        emoji: exceeded ? '⛔' : '⚠️',
        message: exceeded
          ? `⛔ ${user.fullName} (${schoolTag}) was disqualified after ${nextStrikes} anti-cheat violations.`
          : `⚠️ Anti-cheat warning issued to ${user.fullName} (${schoolTag}) (${nextStrikes}/${tournament.maxTabSwitchesAllowed} strikes).`,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        school: { select: { id: true, name: true, schoolCode: true } },
      },
    });

    this.gateway.emitFeedEvent(tournamentId, feedEvent);
    this.gateway.emitStandingsUpdate(tournamentId, { updatedAt: new Date().toISOString() });

    return {
      disqualified: exceeded,
      disqualificationReason,
      tabSwitchCount: nextStrikes,
      maxAllowed: tournament.maxTabSwitchesAllowed,
    };
  }

  // ============================================================================
  // 5. LIVE SPECTATOR STREAM CHEERS
  // ============================================================================

  async sendSpectatorCheer(
    userId: string,
    tournamentId: string,
    dto: SendSpectatorCheerDto,
  ) {
    const [user, tournament] = await Promise.all([
      this.loadUserWithProfile(userId),
      this.prisma.academicTournament.findUnique({ where: { id: tournamentId } }),
    ]);
    if (!tournament) throw new NotFoundException('Olympiad not found.');

    const emoji = (dto.emoji || '🔥').trim();
    const rawMsg = dto.message?.trim();
    const schoolTag = user.school?.schoolCode || 'IND';
    const finalMsg = rawMsg
      ? `${user.fullName} (${schoolTag}): ${rawMsg}`
      : `${user.fullName} (${schoolTag}) cheered for the scholars!`;

    const event = await this.prisma.tournamentSpectatorEvent.create({
      data: {
        tournamentId,
        userId,
        schoolId: user.schoolId,
        eventType: 'CHEER',
        emoji,
        message: finalMsg,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        school: { select: { id: true, name: true, schoolCode: true } },
      },
    });

    this.gateway.emitFeedEvent(tournamentId, event);
    return event;
  }
}
