import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PositionRankingCalculator } from './calculators/position-ranking.calculator.js';
import { GpaCgpaCalculator } from './calculators/gpa-cgpa.calculator.js';
import {
  InstitutionStage,
  resolveCohortGroup,
} from './calculators/cohort-grouping.helper.js';
import {
  LiveRankingMover,
  LiveRankingsGateway,
} from './gateways/live-rankings.gateway.js';

export type LiveRankingScope =
  | 'CLASS'
  | 'COMBINED_CLASS'
  | 'SUBJECT'
  | 'DEPARTMENT'
  | 'FACULTY'
  | 'SCHOOL'
  | 'SCHOOL_TOP_10';

export type LiveRankingMetricMode = 'SEMESTER_GPA' | 'CUMULATIVE_CGPA';

export interface LiveRankingRow {
  rank: number | null;
  ordinal: string;
  previousRank: number | null;
  rankDelta: number;
  isNew: boolean;
  studentId: string;
  fullName: string;
  matricOrAdmissionNo: string;
  avatarUrl: string | null;
  classId: string;
  className: string;
  levelCode: string | null;
  combinedKey: string;
  combinedLabel: string;
  departmentName: string | null;
  unitName: string | null;
  averageScore: number;
  totalPoints: number;
  gpa: number;
  cgpa: number;
  gpaScaleMax: number;
  totalUnits: number;
  cumulativeUnits: number;
  gradedSubjectsCount: number;
  enrolledSubjectsCount: number;
  cumulativeGradedCount: number;
  rating: number;
  letterGrade: string;
  bestSubject: { courseCode: string; name: string; score: number } | null;
  latestUpdatedAt: string | null;
  isMe: boolean;
}

interface SnapshotState {
  previous: Map<string, number>;
  latest: Map<string, number>;
}

@Injectable()
export class LiveRankingsService {
  /**
   * Tracks previous vs latest ranks per (schoolId::termId::scopeKey) so live score
   * saves immediately surface SofaScore-style rank movements (▲ +2, ▼ -1, NEW).
   */
  private readonly rankSnapshots = new Map<string, SnapshotState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveRankingsGateway,
    private readonly rankingCalculator: PositionRankingCalculator,
    private readonly gpaCalculator: GpaCgpaCalculator,
  ) {}

  private isTertiaryInstitution(institutionType?: string | null): boolean {
    return (
      institutionType === 'UNIVERSITY' ||
      institutionType === 'POLYTECHNIC' ||
      institutionType === 'COLLEGE_OF_EDUCATION' ||
      institutionType === 'TECHNICAL'
    );
  }

  private getSnapshotKey(schoolId: string, termId: string, scopeKey: string) {
    return `${schoolId}::${termId}::${scopeKey}`;
  }

  private buildRankMap(rows: Array<{ studentId: string; rank: number | null }>) {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.rank !== null) map.set(r.studentId, r.rank);
    }
    return map;
  }

  /**
   * Capture current rankings as the baseline BEFORE applying a score update,
   * then commit the updated rankings after the write so deltas reflect the latest save.
   */
  async captureBaselineSnapshot(schoolId: string, termId: string) {
    try {
      const dataset = await this.computeSchoolDataset(schoolId, termId);
      const schoolKey = this.getSnapshotKey(schoolId, termId, 'SCHOOL');
      if (!this.rankSnapshots.has(schoolKey)) {
        const ranked = this.rankRows(dataset.allStudentRows, dataset.isTertiary);
        const map = this.buildRankMap(ranked);
        this.rankSnapshots.set(schoolKey, {
          previous: new Map(map),
          latest: new Map(map),
        });
      }

      // Also capture per-class and per-combined baselines if unseen
      for (const cls of dataset.classesMeta) {
        const clsKey = this.getSnapshotKey(schoolId, termId, `CLASS:${cls.id}`);
        if (!this.rankSnapshots.has(clsKey)) {
          const subset = dataset.allStudentRows.filter((r) => r.classId === cls.id);
          const map = this.buildRankMap(this.rankRows(subset, dataset.isTertiary));
          this.rankSnapshots.set(clsKey, {
            previous: new Map(map),
            latest: new Map(map),
          });
        }
      }

      for (const comb of dataset.combinedCohorts) {
        const cKey = this.getSnapshotKey(
          schoolId,
          termId,
          `COMBINED:${comb.key}`,
        );
        if (!this.rankSnapshots.has(cKey)) {
          const idSet = new Set(comb.classIds);
          const subset = dataset.allStudentRows.filter((r) => idSet.has(r.classId));
          const map = this.buildRankMap(this.rankRows(subset, dataset.isTertiary));
          this.rankSnapshots.set(cKey, {
            previous: new Map(map),
            latest: new Map(map),
          });
        }
      }
    } catch {
      // Non-critical telemetry snapshot
    }
  }

  async broadcastScoreMutation(params: {
    schoolId: string;
    termId: string;
    eventType: 'GRADES_SAVED' | 'CBT_IMPORTED' | 'RESULTS_PUBLISHED' | 'CONFIG_UPDATED';
    subjectId?: string;
    subjectName?: string;
    classId?: string;
    className?: string;
    updatedCount?: number;
  }) {
    try {
      const dataset = await this.computeSchoolDataset(params.schoolId, params.termId);

      // Rotate snapshots for SCHOOL, touched CLASS, and touched COMBINED cohort
      const rotate = (scopeKey: string, rows: LiveRankingRow[]) => {
        const ranked = this.rankRows(rows, dataset.isTertiary);
        const newMap = this.buildRankMap(ranked);
        const snapKey = this.getSnapshotKey(params.schoolId, params.termId, scopeKey);
        const existing = this.rankSnapshots.get(snapKey);
        this.rankSnapshots.set(snapKey, {
          previous: existing ? new Map(existing.latest) : new Map(),
          latest: newMap,
        });
        return { ranked, prevMap: existing?.latest ?? new Map<string, number>() };
      };

      const schoolResult = rotate('SCHOOL', dataset.allStudentRows);
      let combinedKey: string | undefined;
      let combinedLabel: string | undefined;
      let moversSource = schoolResult;

      if (params.classId) {
        const clsMeta = dataset.classesMeta.find((c) => c.id === params.classId);
        if (clsMeta) {
          combinedKey = clsMeta.cohort.combinedKey;
          combinedLabel = clsMeta.cohort.combinedLabel;
          const classResult = rotate(
            `CLASS:${params.classId}`,
            dataset.allStudentRows.filter((r) => r.classId === params.classId),
          );
          const idSet = new Set(
            dataset.classesMeta
              .filter((c) => c.cohort.combinedKey === clsMeta.cohort.combinedKey)
              .map((c) => c.id),
          );
          rotate(
            `COMBINED:${clsMeta.cohort.combinedKey}`,
            dataset.allStudentRows.filter((r) => idSet.has(r.classId)),
          );
          moversSource = classResult;
        }
      }

      const movers: LiveRankingMover[] = moversSource.ranked
        .filter((r) => r.rank !== null)
        .map((r) => {
          const prev = moversSource.prevMap.get(r.studentId) ?? null;
          const delta = prev !== null && r.rank !== null ? prev - r.rank : 0;
          return {
            studentId: r.studentId,
            fullName: r.fullName,
            className: r.className,
            newRank: r.rank!,
            previousRank: prev,
            rankDelta: delta,
            averageScore: r.averageScore,
            gpa: r.gpa,
          };
        })
        .sort(
          (a, b) =>
            Math.abs(b.rankDelta) - Math.abs(a.rankDelta) ||
            a.newRank - b.newRank,
        )
        .slice(0, 5);

      const summaryText =
        params.eventType === 'RESULTS_PUBLISHED'
          ? `${params.className || 'Class'} official results published`
          : params.subjectName
          ? `${params.className ? `${params.className} • ` : ''}${params.subjectName} scores updated (${params.updatedCount ?? movers.length} entries)`
          : `${params.className || 'School'} grading standings updated`;

      this.gateway.emitLiveUpdate({
        schoolId: params.schoolId,
        termId: params.termId,
        termName: dataset.term.name,
        sessionName: dataset.term.sessionName,
        eventType: params.eventType,
        subjectId: params.subjectId,
        subjectName: params.subjectName,
        classId: params.classId,
        className: params.className,
        combinedKey,
        combinedLabel,
        updatedCount: params.updatedCount,
        summaryText,
        movers,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Never block grade mutations if websocket broadcast encounters transient issues
    }
  }

  /**
   * Role-scoped Live SofaScore-style Standings endpoint for School Admins, Teachers/Lecturers, and Students.
   */
  async getLiveRankings(
    userId: string,
    schoolId: string,
    query: {
      scope?: LiveRankingScope;
      termId?: string;
      sessionId?: string;
      classId?: string;
      combinedKey?: string;
      subjectId?: string;
      departmentId?: string;
      unitId?: string;
      metricMode?: LiveRankingMetricMode;
      levelCode?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        studentProfile: {
          select: { classId: true, departmentId: true, matricOrAdmissionNo: true },
        },
        teacherProfile: {
          include: {
            department: { select: { id: true, name: true, unitId: true } },
            assignedClasses: { select: { id: true, departmentId: true } },
            assignedSubjects: {
              select: { id: true, classId: true, departmentId: true },
            },
          },
        },
        memberships: {
          where: { schoolId },
          select: { role: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found.');
    const effectiveRole =
      user.memberships?.[0]?.role || user.role;

    if (
      effectiveRole !== 'SUPER_ADMIN' &&
      user.schoolId !== schoolId &&
      user.memberships.length === 0
    ) {
      throw new ForbiddenException('You do not belong to this institution.');
    }

    // Resolve term & sessions
    const sessions = await this.prisma.academicSession.findMany({
      where: { schoolId },
      include: { terms: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    const allTerms = sessions.flatMap((s) =>
      s.terms.map((t) => ({
        id: t.id,
        name: t.name,
        isCurrent: t.isCurrent,
        sessionId: s.id,
        sessionName: s.name,
      })),
    );

    const resolvedTerm =
      (query.termId && allTerms.find((t) => t.id === query.termId)) ||
      (query.sessionId &&
        allTerms.find((t) => t.sessionId === query.sessionId && t.isCurrent)) ||
      (query.sessionId && allTerms.find((t) => t.sessionId === query.sessionId)) ||
      allTerms.find((t) => t.isCurrent) ||
      allTerms[0];

    if (!resolvedTerm) {
      throw new NotFoundException('No academic term found for this institution.');
    }

    const dataset = await this.computeSchoolDataset(schoolId, resolvedTerm.id);

    // Ensure a baseline snapshot exists so subsequent saves show rank deltas
    await this.captureBaselineSnapshot(schoolId, resolvedTerm.id);

    // Determine role context & enforce student / teacher boundaries
    let activeScope: LiveRankingScope =
      query.scope ||
      (effectiveRole === 'STUDENT' || effectiveRole === 'TEACHER'
        ? 'CLASS'
        : 'SCHOOL');

    let studentContext: {
      myClassId: string | null;
      myClassName: string | null;
      myCombinedKey: string | null;
      myCombinedLabel: string | null;
      myDeptCombinedKey: string | null;
      myDeptCombinedLabel: string | null;
      myLevelCode: string | null;
      myFacultyId: string | null;
      myFacultyName: string | null;
      myDepartmentId: string | null;
      myDepartmentName: string | null;
    } | null = null;

    // Student class resolution
    const myStudentRow =
      effectiveRole === 'STUDENT'
        ? dataset.allStudentRows.find((r) => r.studentId === userId) || null
        : null;
    const studentClassId =
      user.studentProfile?.classId || user.classId || myStudentRow?.classId || null;
    const studentClassMeta = studentClassId
      ? dataset.classesMeta.find((c) => c.id === studentClassId) || null
      : null;

    const normalizeLevelTag = (raw?: string | null): string => {
      const m = String(raw || '').match(/(100|200|300|400|500|600|700|ND\s*[12]|HND\s*[12])/i);
      if (m) return m[1].replace(/\s+/g, '').toUpperCase().replace(/^(\d{3})$/, '$1L');
      return String(raw || '').trim().toUpperCase();
    };
    const studentLevelTag = studentClassMeta
      ? normalizeLevelTag(studentClassMeta.levelCode || studentClassMeta.name)
      : '';

    const activeMetricMode: LiveRankingMetricMode =
      dataset.isTertiary && activeScope !== 'SUBJECT' && query.metricMode === 'CUMULATIVE_CGPA'
        ? 'CUMULATIVE_CGPA'
        : 'SEMESTER_GPA';

    if (dataset.isTertiary && activeMetricMode === 'CUMULATIVE_CGPA') {
      if (effectiveRole === 'STUDENT') {
        // Student Cumulative CGPA is strictly Faculty-wide across 100L to Final Year
        activeScope = 'FACULTY';
      } else if (effectiveRole === 'TEACHER') {
        // Lecturer Cumulative CGPA is scoped to their own Department across its levels
        activeScope = 'DEPARTMENT';
      }
    }

    if (effectiveRole === 'STUDENT') {
      studentContext = {
        myClassId: studentClassMeta?.id ?? null,
        myClassName: studentClassMeta?.name ?? null,
        myCombinedKey: studentClassMeta?.cohort.combinedKey ?? null,
        myCombinedLabel: studentClassMeta?.cohort.combinedLabel ?? null,
        myDeptCombinedKey: studentClassMeta?.cohort.deptCombinedKey ?? null,
        myDeptCombinedLabel: studentClassMeta?.cohort.deptCombinedLabel ?? null,
        myLevelCode: studentLevelTag || null,
        myFacultyId: studentClassMeta?.unitId ?? null,
        myFacultyName: studentClassMeta?.unitName ?? null,
        myDepartmentId: studentClassMeta?.departmentId ?? null,
        myDepartmentName: studentClassMeta?.departmentName ?? null,
      };

      if (activeScope === 'SCHOOL' || (dataset.isTertiary && activeScope === 'COMBINED_CLASS')) {
        activeScope = dataset.isTertiary ? 'FACULTY' : 'SCHOOL_TOP_10';
      }
      const allowedStudentScopes: LiveRankingScope[] = dataset.isTertiary
        ? ['CLASS', 'FACULTY']
        : ['CLASS', 'COMBINED_CLASS', 'SCHOOL_TOP_10'];
      if (!allowedStudentScopes.includes(activeScope)) {
        throw new ForbiddenException(
          dataset.isTertiary
            ? 'Students can only view rankings for their current level & department, or their current level across all departments in their Faculty.'
            : 'Students can view live rankings for their own class, combined level, or Overall School Top 10.',
        );
      }
      if (activeScope === 'CLASS') {
        if (!studentClassId) {
          throw new BadRequestException('You are not assigned to a class cohort yet.');
        }
        if (query.classId && query.classId !== studentClassId) {
          throw new ForbiddenException(
            dataset.isTertiary
              ? 'You can only view your own current level and department.'
              : 'Students can only view live rankings for their own enrolled class.',
          );
        }
      }
      if (activeScope === 'COMBINED_CLASS' && !dataset.isTertiary) {
        const targetCombKey =
          query.combinedKey ||
          studentClassMeta?.cohort.combinedKey ||
          studentClassMeta?.cohort.deptCombinedKey;
        const allowedKeys = new Set(
          [
            studentClassMeta?.cohort.combinedKey,
            studentClassMeta?.cohort.deptCombinedKey,
          ].filter(Boolean) as string[],
        );
        if (!targetCombKey || !allowedKeys.has(targetCombKey)) {
          throw new ForbiddenException(
            'Students can only view combined class/level rankings for their own cohort.',
          );
        }
      }
    }

    // Teacher assigned classes, subjects & parent department
    const teacherAssignedClassIds = new Set<string>();
    const teacherAssignedSubjectIds = new Set<string>();
    let teacherDepartmentId: string | null =
      user.teacherProfile?.departmentId || null;

    if (effectiveRole === 'TEACHER') {
      user.teacherProfile?.assignedClasses.forEach((c) => {
        teacherAssignedClassIds.add(c.id);
        if (!teacherDepartmentId && c.departmentId) {
          teacherDepartmentId = c.departmentId;
        }
      });
      user.teacherProfile?.assignedSubjects.forEach((s) => {
        teacherAssignedSubjectIds.add(s.id);
        if (s.classId) teacherAssignedClassIds.add(s.classId);
        if (!teacherDepartmentId && s.departmentId) {
          teacherDepartmentId = s.departmentId;
        }
      });
      if (user.teacherProfile?.handlesAllSubjects) {
        dataset.subjectsMeta.forEach((subj) => {
          if (teacherAssignedClassIds.has(subj.classId)) {
            teacherAssignedSubjectIds.add(subj.id);
          }
        });
      }
      const legacyClasses = await this.prisma.schoolClass.findMany({
        where: { schoolId, formTeacherId: userId },
        select: { id: true, departmentId: true },
      });
      legacyClasses.forEach((c) => {
        teacherAssignedClassIds.add(c.id);
        if (!teacherDepartmentId && c.departmentId) {
          teacherDepartmentId = c.departmentId;
        }
      });
      const legacySubjects = await this.prisma.schoolSubject.findMany({
        where: { schoolId, teacherId: userId },
        select: { id: true, classId: true, departmentId: true },
      });
      legacySubjects.forEach((s) => {
        teacherAssignedSubjectIds.add(s.id);
        if (s.classId) teacherAssignedClassIds.add(s.classId);
        if (!teacherDepartmentId && s.departmentId) {
          teacherDepartmentId = s.departmentId;
        }
      });

      if (dataset.isTertiary) {
        if (!teacherDepartmentId && teacherAssignedClassIds.size > 0) {
          const firstCls = dataset.classesMeta.find((c) =>
            teacherAssignedClassIds.has(c.id),
          );
          teacherDepartmentId = firstCls?.departmentId ?? null;
        }
        if (
          !['CLASS', 'DEPARTMENT', 'SUBJECT'].includes(activeScope)
        ) {
          if (!query.scope) {
            activeScope = 'CLASS';
          } else {
            throw new ForbiddenException(
              'Lecturers can only view standings for their assigned levels, assigned courses, and levels under their department.',
            );
          }
        }
      }
    }

    // Determine level tag filter:
    // - On Student Cumulative CGPA (100L to Final Year): always ALL levels combined by Faculty
    // - On Tertiary STUDENT Semester GPA: strictly locked to student's current level
    // - On Tertiary LECTURER / SCHOOL_ADMIN: filterable by levelCode (or ALL arranged in groupedSections)
    const requestedLevelTag =
      dataset.isTertiary &&
      effectiveRole === 'STUDENT' &&
      activeMetricMode === 'CUMULATIVE_CGPA'
        ? ''
        : dataset.isTertiary && effectiveRole === 'STUDENT'
        ? studentLevelTag
        : dataset.isTertiary && query.levelCode && query.levelCode !== 'ALL'
        ? normalizeLevelTag(query.levelCode)
        : '';
    const matchesRequestedLevel = (r: LiveRankingRow) => {
      if (!requestedLevelTag) return true;
      return (
        normalizeLevelTag(r.levelCode || r.className) === requestedLevelTag ||
        normalizeLevelTag(r.combinedLabel) === requestedLevelTag
      );
    };

    // Filter dataset rows & compute scope standings
    let targetRows: LiveRankingRow[] = [];
    let scopeTitle = `${dataset.school.name} Live Standings`;
    let scopeSubtitle = dataset.isTertiary
      ? activeMetricMode === 'CUMULATIVE_CGPA'
        ? 'Cumulative CGPA across all semesters'
        : 'Credit-weighted live Semester GPA table'
      : 'Live terminal average standings';
    let snapshotScopeKey = 'SCHOOL';
    let facultyDepartmentLeaders: Array<{
      departmentName: string;
      levelLabel: string;
      levelCode: string;
      leader: LiveRankingRow;
    }> = [];

    if (activeScope === 'CLASS') {
      if (
        dataset.isTertiary &&
        effectiveRole === 'TEACHER' &&
        query.classId &&
        !teacherAssignedClassIds.has(query.classId)
      ) {
        throw new ForbiddenException(
          'Lecturers can only view assigned level standings for levels they teach.',
        );
      }
      const targetClassId =
        effectiveRole === 'STUDENT'
          ? studentClassId!
          : query.classId ||
            (effectiveRole === 'TEACHER'
              ? Array.from(teacherAssignedClassIds)[0]
              : dataset.classesMeta[0]?.id);
      const clsMeta = dataset.classesMeta.find((c) => c.id === targetClassId);
      if (!clsMeta) {
        if (dataset.isTertiary && effectiveRole === 'TEACHER') {
          targetRows = [];
          scopeTitle = 'No Assigned Levels Yet';
          scopeSubtitle =
            'No level/course has been assigned to you yet. Switch to "My Dept (All Levels)" to inspect your department.';
          snapshotScopeKey = `LECTURER:${userId}`;
        } else {
          throw new NotFoundException('Target class or cohort not found.');
        }
      } else {
        targetRows = dataset.allStudentRows.filter((r) => r.classId === clsMeta.id);
        scopeTitle = `${clsMeta.name} Live Table`;
        scopeSubtitle = `${clsMeta.departmentName ? `${clsMeta.departmentName} • ` : ''}${targetRows.length} enrolled student(s)`;
        snapshotScopeKey = `CLASS:${clsMeta.id}`;
      }
    } else if (activeScope === 'COMBINED_CLASS') {
      if (dataset.isTertiary && effectiveRole === 'STUDENT' && studentLevelTag) {
        targetRows = dataset.allStudentRows.filter(
          (r) =>
            normalizeLevelTag(r.levelCode || r.className) === studentLevelTag,
        );
        scopeTitle = `All ${studentLevelTag} Students Across ${dataset.school.name}`;
        scopeSubtitle = `Combines all ${studentLevelTag} students across every Faculty & Department • ${targetRows.length} student(s)`;
        snapshotScopeKey = `LEVEL_SCHOOL:${studentLevelTag}`;
      } else {
        const defaultKey =
          studentClassMeta?.cohort.combinedKey ||
          dataset.combinedCohorts.find((c) => c.isCombined)?.key ||
          dataset.combinedCohorts[0]?.key;
        const targetKey = query.combinedKey || defaultKey;
        const comb = dataset.combinedCohorts.find((c) => c.key === targetKey);
        if (!comb) {
          throw new NotFoundException('Combined class / level group not found.');
        }
        const idSet = new Set(comb.classIds);
        targetRows = dataset.allStudentRows.filter((r) => idSet.has(r.classId));
        if (dataset.isTertiary) {
          scopeTitle = `All ${comb.label} Across Campus`;
          scopeSubtitle = `Combines ${comb.armNames.join(', ')} across faculties • ${targetRows.length} student(s)`;
        } else {
          scopeTitle = `${comb.label} (${comb.isCombined ? 'Combined Arms' : 'Full Level'})`;
          scopeSubtitle = `Merged: ${comb.armNames.join(', ')} • ${targetRows.length} student(s)`;
        }
        snapshotScopeKey = `COMBINED:${comb.key}`;
      }
    } else if (activeScope === 'SUBJECT') {
      if (
        dataset.isTertiary &&
        effectiveRole === 'TEACHER' &&
        query.subjectId &&
        !teacherAssignedSubjectIds.has(query.subjectId)
      ) {
        throw new ForbiddenException(
          'Lecturers can only view standings for courses assigned to them.',
        );
      }
      const targetSubjectId =
        query.subjectId ||
        (effectiveRole === 'TEACHER'
          ? Array.from(teacherAssignedSubjectIds)[0]
          : dataset.subjectsMeta[0]?.id);
      const subj = dataset.subjectsMeta.find((s) => s.id === targetSubjectId);
      if (!subj) {
        if (dataset.isTertiary && effectiveRole === 'TEACHER') {
          targetRows = [];
          scopeTitle = 'No Assigned Courses Yet';
          scopeSubtitle = 'No courses assigned to your profile for this semester.';
          snapshotScopeKey = `LECTURER_SUBJ:${userId}`;
        } else {
          throw new NotFoundException('Course / subject not found.');
        }
      } else {
        targetRows = this.buildSubjectRows(dataset, subj.id);
        scopeTitle = `${subj.name} (${subj.courseCode})`;
        scopeSubtitle = `${subj.className} • Live subject score standings`;
        snapshotScopeKey = `SUBJECT:${subj.id}`;
      }
    } else if (activeScope === 'DEPARTMENT') {
      if (
        dataset.isTertiary &&
        effectiveRole === 'TEACHER' &&
        query.departmentId &&
        teacherDepartmentId &&
        query.departmentId !== teacherDepartmentId
      ) {
        throw new ForbiddenException(
          'Lecturers can only view rankings for levels under the department they belong to.',
        );
      }
      const fallbackDeptForUnit =
        query.unitId
          ? dataset.departmentsMeta.find((d) => d.unitId === query.unitId)?.id
          : undefined;
      const targetDeptId =
        dataset.isTertiary && effectiveRole === 'TEACHER'
          ? teacherDepartmentId || dataset.departmentsMeta[0]?.id
          : query.departmentId ||
            fallbackDeptForUnit ||
            (effectiveRole === 'STUDENT'
              ? user.studentProfile?.departmentId || undefined
              : undefined) ||
            dataset.departmentsMeta[0]?.id;
      const dept = dataset.departmentsMeta.find((d) => d.id === targetDeptId);
      if (!dept) throw new NotFoundException('Department not found.');
      targetRows = dataset.allStudentRows.filter(
        (r) =>
          dataset.classesMeta.find((c) => c.id === r.classId)?.departmentId ===
            dept.id && matchesRequestedLevel(r),
      );
      scopeTitle = `${dept.name}${requestedLevelTag ? ` • ${requestedLevelTag}` : ' (All Levels)'}`;
      scopeSubtitle = `${
        activeMetricMode === 'CUMULATIVE_CGPA' ? 'Cumulative CGPA • ' : ''
      }${requestedLevelTag || 'All levels'} under ${dept.name} • ${targetRows.length} student(s)`;
      snapshotScopeKey = `DEPT:${dept.id}`;
    } else if (activeScope === 'FACULTY') {
      const profileDeptUnitId = user.studentProfile?.departmentId
        ? dataset.departmentsMeta.find((d) => d.id === user.studentProfile?.departmentId)
            ?.unitId ?? undefined
        : undefined;
      const studentUnitId = studentClassMeta?.unitId || profileDeptUnitId;
      const targetUnitId =
        effectiveRole === 'STUDENT'
          ? studentUnitId || dataset.unitsMeta[0]?.id
          : query.unitId || dataset.unitsMeta[0]?.id;
      const unit = dataset.unitsMeta.find((u) => u.id === targetUnitId);
      if (!unit) throw new NotFoundException('Faculty / Section not found.');
      const unitDeptIds = new Set(
        dataset.departmentsMeta
          .filter((d) => d.unitId === unit.id)
          .map((d) => d.id),
      );
      const scopedDeptInFaculty =
        dataset.isTertiary &&
        effectiveRole !== 'STUDENT' &&
        query.departmentId &&
        dataset.departmentsMeta.some(
          (d) => d.id === query.departmentId && d.unitId === unit.id,
        )
          ? query.departmentId
          : undefined;
      const facultyAllRows = dataset.allStudentRows.filter((r) => {
        const cls = dataset.classesMeta.find((c) => c.id === r.classId);
        const matchesUnit =
          cls?.unitId === unit.id ||
          (cls?.departmentId ? unitDeptIds.has(cls.departmentId) : false) ||
          r.unitName === unit.name;
        if (!matchesUnit) return false;
        if (scopedDeptInFaculty && cls?.departmentId !== scopedDeptInFaculty) {
          return false;
        }
        return true;
      });
      targetRows = facultyAllRows.filter(matchesRequestedLevel);

      if (dataset.isTertiary) {
        // Group top #1 leader for each (Department + Level) under this Faculty
        const byDeptLevel = new Map<string, LiveRankingRow[]>();
        for (const r of targetRows) {
          const deptName = r.departmentName || 'General';
          const lvlLabel = r.className || normalizeLevelTag(r.levelCode) || 'Level';
          const key = `${deptName}::${lvlLabel}`;
          const arr = byDeptLevel.get(key) || [];
          arr.push(r);
          byDeptLevel.set(key, arr);
        }
        for (const [k, groupRows] of byDeptLevel.entries()) {
          const rankedGroup = this.rankRows(
            groupRows,
            true,
            undefined,
            userId,
            activeMetricMode,
          );
          const topLeader = rankedGroup.find((g) => g.rank === 1);
          if (topLeader) {
            const [departmentName, levelLabel] = k.split('::');
            facultyDepartmentLeaders.push({
              departmentName,
              levelLabel,
              levelCode: normalizeLevelTag(topLeader.levelCode || levelLabel),
              leader: topLeader,
            });
          }
        }
        facultyDepartmentLeaders.sort((a, b) =>
          `${a.departmentName} ${a.levelCode}`.localeCompare(
            `${b.departmentName} ${b.levelCode}`,
          ),
        );
      }

      const pickedDeptName = scopedDeptInFaculty
        ? dataset.departmentsMeta.find((d) => d.id === scopedDeptInFaculty)?.name
        : null;
      if (dataset.isTertiary && activeMetricMode === 'CUMULATIVE_CGPA') {
        scopeTitle = `${pickedDeptName || unit.name} • Cumulative CGPA`;
        scopeSubtitle = pickedDeptName
          ? `Overall CGPA across all levels under ${pickedDeptName} (${unit.code || unit.name}) • ${targetRows.length} student(s)`
          : `Overall CGPA from 100L to Final Level across all departments in ${unit.code || unit.name} • ${targetRows.length} student(s)`;
      } else {
        scopeTitle = `${pickedDeptName || unit.name}${requestedLevelTag ? ` • ${requestedLevelTag}` : ''} Standings`;
        scopeSubtitle = pickedDeptName
          ? `${requestedLevelTag || 'All levels'} under ${pickedDeptName} • ${targetRows.length} student(s)`
          : `${
              requestedLevelTag
                ? `All ${requestedLevelTag} departments in ${unit.code || unit.name} combined • `
                : `All levels in ${unit.code || unit.name} arranged by Department & Level • `
            }${targetRows.length} student(s)`;
      }
      snapshotScopeKey = `UNIT:${unit.id}`;
    } else {
      targetRows = dataset.allStudentRows.filter(matchesRequestedLevel);
      scopeTitle =
        activeScope === 'SCHOOL_TOP_10'
          ? `${dataset.isTertiary ? 'Campus' : 'Overall School'} Top 10${requestedLevelTag ? ` (${requestedLevelTag})` : ''}`
          : `${dataset.school.name} • ${activeMetricMode === 'CUMULATIVE_CGPA' ? 'Cumulative CGPA Leaderboard' : 'Overall Leaderboard'}`;
      scopeSubtitle =
        activeScope === 'SCHOOL_TOP_10'
          ? `Top 10 performers ${requestedLevelTag ? `in ${requestedLevelTag}` : 'across all levels'}`
          : `All ${targetRows.length} enrolled students ranked live`;
      snapshotScopeKey = 'SCHOOL';
    }

    const snap = this.rankSnapshots.get(
      this.getSnapshotKey(schoolId, resolvedTerm.id, snapshotScopeKey),
    );
    const prevMap = snap?.previous ?? new Map<string, number>();

    const rankedAll = this.rankRows(
      targetRows,
      activeScope === 'SUBJECT' ? false : dataset.isTertiary,
      prevMap,
      userId,
      activeMetricMode,
    );

    const myStanding = rankedAll.find((r) => r.studentId === userId) || null;
    const isRestrictedTopTen =
      effectiveRole === 'STUDENT' && activeScope === 'SCHOOL_TOP_10';

    const visibleStandings = isRestrictedTopTen
      ? rankedAll.filter((r) => r.rank !== null).slice(0, 10)
      : activeScope === 'SCHOOL_TOP_10'
      ? rankedAll.filter((r) => r.rank !== null).slice(0, 10)
      : rankedAll;

    const rankedOnly = rankedAll.filter((r) => r.rank !== null);
    const passedCount = rankedOnly.filter((r) => r.averageScore >= 40).length;
    const scopeAverageScore =
      rankedOnly.length > 0
        ? Math.round(
            (rankedOnly.reduce((sum, r) => sum + r.averageScore, 0) /
              rankedOnly.length) *
              100,
          ) / 100
        : 0;

    // Shape available scope selectors according to user's role
    const lecturerDepartmentLevels =
      dataset.isTertiary && effectiveRole === 'TEACHER'
        ? Array.from(
            new Set(
              dataset.classesMeta
                .filter((c) =>
                  teacherDepartmentId ? c.departmentId === teacherDepartmentId : false,
                )
                .map((c) => normalizeLevelTag(c.levelCode || c.name))
                .filter(Boolean),
            ),
          ).sort()
        : [];

    const groupedSections: Array<{
      key: string;
      facultyName: string;
      departmentName: string;
      levelCode: string;
      levelLabel: string;
      leaderName: string | null;
      leaderScore: number | null;
      rows: LiveRankingRow[];
    }> = [];

    if (
      dataset.isTertiary &&
      effectiveRole !== 'STUDENT' &&
      ['SCHOOL', 'FACULTY', 'DEPARTMENT'].includes(activeScope)
    ) {
      const groupBuckets = new Map<
        string,
        {
          facultyName: string;
          departmentName: string;
          levelCode: string;
          levelLabel: string;
          rawRows: LiveRankingRow[];
        }
      >();
      for (const r of targetRows) {
        const facultyName = r.unitName || 'Campus';
        const departmentName = r.departmentName || 'General Department';
        const levelCode = normalizeLevelTag(r.levelCode || r.className) || 'LEVEL';
        const levelLabel = r.className || levelCode;
        const gKey = `${facultyName}::${departmentName}::${levelCode}`;
        const existing = groupBuckets.get(gKey) || {
          facultyName,
          departmentName,
          levelCode,
          levelLabel,
          rawRows: [],
        };
        existing.rawRows.push(r);
        groupBuckets.set(gKey, existing);
      }

      const sortedEntries = Array.from(groupBuckets.entries()).sort(([, a], [, b]) => {
        const fCmp = a.facultyName.localeCompare(b.facultyName);
        if (fCmp !== 0) return fCmp;
        const dCmp = a.departmentName.localeCompare(b.departmentName);
        if (dCmp !== 0) return dCmp;
        return a.levelCode.localeCompare(b.levelCode);
      });

      for (const [key, bucket] of sortedEntries) {
        const rankedGroup = this.rankRows(
          bucket.rawRows,
          true,
          prevMap,
          userId,
          activeMetricMode,
        );
        const topRow = rankedGroup.find((g) => g.rank === 1) || null;
        groupedSections.push({
          key,
          facultyName: bucket.facultyName,
          departmentName: bucket.departmentName,
          levelCode: bucket.levelCode,
          levelLabel: bucket.levelLabel,
          leaderName: topRow?.fullName || null,
          leaderScore: topRow
            ? activeMetricMode === 'CUMULATIVE_CGPA'
              ? topRow.cgpa
              : topRow.gpa
            : null,
          rows: rankedGroup,
        });
      }
    }

    const availableClasses =
      effectiveRole === 'STUDENT'
        ? dataset.classesMeta
            .filter((c) => c.id === studentClassId)
            .map((c) => ({
              id: c.id,
              name: c.name,
              levelCode: c.levelCode,
              departmentName: c.departmentName,
              combinedKey: c.cohort.combinedKey,
            }))
        : effectiveRole === 'TEACHER'
        ? dataset.classesMeta
            .filter((c) =>
              dataset.isTertiary
                ? teacherAssignedClassIds.has(c.id)
                : teacherAssignedClassIds.size === 0 ||
                  teacherAssignedClassIds.has(c.id),
            )
            .map((c) => ({
              id: c.id,
              name: c.name,
              levelCode: c.levelCode,
              departmentName: c.departmentName,
              combinedKey: c.cohort.combinedKey,
            }))
        : dataset.classesMeta.map((c) => ({
            id: c.id,
            name: c.name,
            levelCode: c.levelCode,
            departmentName: c.departmentName,
            combinedKey: c.cohort.combinedKey,
          }));

    const availableCombined =
      effectiveRole === 'STUDENT'
        ? dataset.combinedCohorts.filter(
            (comb) =>
              comb.key === studentClassMeta?.cohort.combinedKey ||
              comb.key === studentClassMeta?.cohort.deptCombinedKey,
          )
        : effectiveRole === 'TEACHER'
        ? dataset.isTertiary
          ? []
          : dataset.combinedCohorts.filter(
              (comb) =>
                teacherAssignedClassIds.size === 0 ||
                comb.classIds.some((id) => teacherAssignedClassIds.has(id)),
            )
        : dataset.combinedCohorts;

    const availableSubjects =
      effectiveRole === 'STUDENT'
        ? []
        : effectiveRole === 'TEACHER'
        ? dataset.subjectsMeta.filter((s) =>
            dataset.isTertiary
              ? teacherAssignedSubjectIds.has(s.id)
              : teacherAssignedSubjectIds.size === 0 ||
                teacherAssignedSubjectIds.has(s.id),
          )
        : dataset.subjectsMeta;

    return {
      school: {
        id: dataset.school.id,
        name: dataset.school.name,
        institutionType: dataset.school.institutionType,
        isTertiary: dataset.isTertiary,
        gpaScaleMax: dataset.gpaScaleMax,
        logoUrl: dataset.school.logoUrl,
        primaryColor: dataset.school.primaryColor,
      },
      term: {
        id: resolvedTerm.id,
        name: resolvedTerm.name,
        sessionName: resolvedTerm.sessionName,
      },
      terms: allTerms,
      role: effectiveRole,
      activeScope,
      activeMetricMode,
      selectedLevelCode: requestedLevelTag || 'ALL',
      scopeTitle,
      scopeSubtitle,
      studentContext,
      myStanding,
      availableScopes: {
        classes: availableClasses,
        combinedClasses: availableCombined,
        subjects: availableSubjects,
        departments:
          effectiveRole === 'STUDENT'
            ? []
            : dataset.isTertiary && effectiveRole === 'TEACHER'
            ? teacherDepartmentId
              ? dataset.departmentsMeta.filter((d) => d.id === teacherDepartmentId)
              : []
            : dataset.departmentsMeta,
        faculties:
          effectiveRole === 'STUDENT'
            ? dataset.isTertiary && studentClassMeta?.unitId
              ? dataset.unitsMeta.filter((u) => u.id === studentClassMeta.unitId)
              : []
            : dataset.isTertiary && effectiveRole === 'TEACHER'
            ? []
            : dataset.unitsMeta,
        levels:
          dataset.isTertiary && effectiveRole === 'TEACHER'
            ? lecturerDepartmentLevels
            : dataset.isTertiary && effectiveRole !== 'STUDENT'
            ? dataset.levelsMeta
            : [],
      },
      facultyDepartmentLeaders,
      groupedSections,
      summary: {
        totalParticipants: rankedAll.length,
        gradedParticipants: rankedOnly.length,
        topAverageScore: rankedOnly[0]?.averageScore ?? 0,
        topGpa:
          activeMetricMode === 'CUMULATIVE_CGPA'
            ? rankedOnly[0]?.cgpa ?? 0
            : rankedOnly[0]?.gpa ?? 0,
        scopeAverageScore,
        passRate:
          rankedOnly.length > 0
            ? Math.round((passedCount / rankedOnly.length) * 100)
            : 0,
        isRestrictedTopTen,
      },
      podium: rankedOnly.slice(0, 3),
      standings: visibleStandings,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private async computeSchoolDataset(schoolId: string, termId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        institutionType: true,
        logoUrl: true,
        primaryColor: true,
      },
    });
    if (!school) throw new NotFoundException('Institution not found.');

    const term = await this.prisma.academicTerm.findUnique({
      where: { id: termId },
      include: { session: { select: { name: true } } },
    });
    if (!term) throw new NotFoundException('Academic term not found.');

    const isTertiary = this.isTertiaryInstitution(school.institutionType);

    const [
      schoolConfig,
      units,
      departments,
      classes,
      subjects,
      studentUsers,
      grades,
      allSchoolGrades,
    ] = await Promise.all([
      this.prisma.assessmentConfig.findFirst({
        where: { schoolId, subjectId: null },
      }),
      this.prisma.academicUnit.findMany({
        where: { schoolId },
        select: { id: true, name: true, code: true, unitType: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { schoolId },
        include: { unit: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        include: {
          department: {
            include: { unit: { select: { id: true, name: true } } },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolSubject.findMany({
        where: { schoolId },
        include: { schoolClass: { select: { name: true } } },
        orderBy: [{ name: 'asc' }],
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
          classId: true,
          studentProfile: {
            select: {
              classId: true,
              departmentId: true,
              matricOrAdmissionNo: true,
            },
          },
          classEnrollments: {
            select: { classId: true },
            take: 1,
          },
        },
      }),
      this.prisma.studentSubjectGrade.findMany({
        where: { schoolId, termId },
        include: {
          subject: {
            select: { id: true, name: true, courseCode: true, creditUnits: true },
          },
        },
      }),
      isTertiary
        ? this.prisma.studentSubjectGrade.findMany({
            where: { schoolId },
            select: {
              studentId: true,
              totalScore: true,
              gradePoint: true,
              subject: { select: { creditUnits: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const gpaScaleMax = Number(schoolConfig?.gpaScaleMax) || 5.0;

    // Subject count per class
    const subjectCountByClass = new Map<string, number>();
    for (const s of subjects) {
      subjectCountByClass.set(
        s.classId,
        (subjectCountByClass.get(s.classId) || 0) + 1,
      );
    }

    const classesMeta = classes.map((cls) => ({
      id: cls.id,
      name: cls.name,
      levelCode: cls.levelCode,
      departmentId: cls.departmentId,
      departmentName: cls.department?.name ?? null,
      unitId: cls.department?.unit?.id ?? null,
      unitName: cls.department?.unit?.name ?? null,
      cohort: resolveCohortGroup(
        {
          name: cls.name,
          levelCode: cls.levelCode,
          departmentId: cls.departmentId,
          departmentName: cls.department?.name ?? null,
        },
        school.institutionType,
      ),
    }));
    const classMetaById = new Map(classesMeta.map((c) => [c.id, c]));

    // Group grades by studentId (current term) & all terms (for cumulative CGPA)
    const gradesByStudent = new Map<string, typeof grades>();
    for (const g of grades) {
      const list = gradesByStudent.get(g.studentId) || [];
      list.push(g);
      gradesByStudent.set(g.studentId, list);
    }

    const cumulativeGradesByStudent = new Map<
      string,
      Array<{ gradePoint: number; units: number }>
    >();
    for (const g of allSchoolGrades) {
      const list = cumulativeGradesByStudent.get(g.studentId) || [];
      list.push({
        gradePoint: Number(g.gradePoint) || 0,
        units: Math.max(1, Number(g.subject?.creditUnits) || 1),
      });
      cumulativeGradesByStudent.set(g.studentId, list);
    }

    // Build unified student rows (including enrolled students awaiting scores)
    const allStudentRows: LiveRankingRow[] = [];
    const seenStudentIds = new Set<string>();

    for (const stu of studentUsers) {
      seenStudentIds.add(stu.id);
      const stuGrades = gradesByStudent.get(stu.id) || [];
      const resolvedClassId =
        stu.studentProfile?.classId ||
        stu.classEnrollments?.[0]?.classId ||
        stu.classId ||
        stuGrades[0]?.classId ||
        '';
      const clsMeta = classMetaById.get(resolvedClassId);
      const enrolledSubjectsCount =
        subjectCountByClass.get(resolvedClassId) || stuGrades.length;

      allStudentRows.push(
        this.aggregateStudentRow({
          studentId: stu.id,
          fullName: stu.fullName || 'Student',
          avatarUrl: stu.avatarUrl,
          matricOrAdmissionNo: stu.studentProfile?.matricOrAdmissionNo || '—',
          clsMeta,
          stuGrades,
          cumulativeGrades: cumulativeGradesByStudent.get(stu.id) || [],
          enrolledSubjectsCount,
          isTertiary,
          gpaScaleMax,
          institutionType: school.institutionType,
        }),
      );
    }

    // Build Combined Cohort Options (both Campus-Level and Tertiary Dept-Level when applicable)
    const combinedMap = new Map<
      string,
      {
        key: string;
        label: string;
        stage: InstitutionStage;
        armNames: string[];
        classIds: string[];
        totalStudents: number;
      }
    >();

    const studentCountByClass = new Map<string, number>();
    for (const r of allStudentRows) {
      if (r.classId) {
        studentCountByClass.set(
          r.classId,
          (studentCountByClass.get(r.classId) || 0) + 1,
        );
      }
    }

    for (const cls of classesMeta) {
      const count = studentCountByClass.get(cls.id) || 0;
      const existing = combinedMap.get(cls.cohort.combinedKey);
      if (!existing) {
        combinedMap.set(cls.cohort.combinedKey, {
          key: cls.cohort.combinedKey,
          label: cls.cohort.combinedLabel,
          stage: cls.cohort.stage,
          armNames: [cls.name],
          classIds: [cls.id],
          totalStudents: count,
        });
      } else {
        existing.armNames.push(cls.name);
        existing.classIds.push(cls.id);
        existing.totalStudents += count;
      }

      if (cls.cohort.deptCombinedKey && cls.cohort.deptCombinedLabel) {
        const deptEx = combinedMap.get(cls.cohort.deptCombinedKey);
        if (!deptEx) {
          combinedMap.set(cls.cohort.deptCombinedKey, {
            key: cls.cohort.deptCombinedKey,
            label: cls.cohort.deptCombinedLabel,
            stage: cls.cohort.stage,
            armNames: [cls.name],
            classIds: [cls.id],
            totalStudents: count,
          });
        } else {
          deptEx.armNames.push(cls.name);
          deptEx.classIds.push(cls.id);
          deptEx.totalStudents += count;
        }
      }
    }

    const combinedCohorts = Array.from(combinedMap.values())
      .map((c) => ({
        ...c,
        isCombined: c.classIds.length > 1,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const levelsSet = new Set<string>();
    for (const cls of classesMeta) {
      const m = String(cls.levelCode || cls.name || '').match(
        /(100|200|300|400|500|600|700|ND\s*[12]|HND\s*[12])/i,
      );
      if (m) {
        levelsSet.add(
          m[1].replace(/\s+/g, '').toUpperCase().replace(/^(\d{3})$/, '$1L'),
        );
      }
    }
    const levelsMeta = Array.from(levelsSet).sort();

    return {
      school,
      term: {
        id: term.id,
        name: term.name,
        sessionName: term.session.name,
      },
      isTertiary,
      gpaScaleMax,
      unitsMeta: units,
      departmentsMeta: departments.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        unitId: d.unit?.id ?? null,
        unitName: d.unit?.name ?? null,
      })),
      levelsMeta,
      classesMeta,
      subjectsMeta: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        courseCode: s.courseCode,
        creditUnits: s.creditUnits,
        classId: s.classId,
        className: s.schoolClass.name,
      })),
      combinedCohorts,
      grades,
      studentUsers,
      allStudentRows,
    };
  }

  private aggregateStudentRow(params: {
    studentId: string;
    fullName: string;
    avatarUrl: string | null;
    matricOrAdmissionNo: string;
    clsMeta?: {
      id: string;
      name: string;
      levelCode?: string | null;
      departmentName: string | null;
      unitName: string | null;
      cohort: { combinedKey: string; combinedLabel: string };
    };
    stuGrades: Array<{
      totalScore: number;
      gradePoint: number;
      letterGrade: string;
      updatedAt: Date;
      subject: { id: string; name: string; courseCode: string; creditUnits: number | null };
    }>;
    cumulativeGrades?: Array<{ gradePoint: number; units: number }>;
    enrolledSubjectsCount: number;
    isTertiary: boolean;
    gpaScaleMax: number;
    institutionType?: string | null;
  }): LiveRankingRow {
    const gradedSubjectsCount = params.stuGrades.length;
    let totalPoints = 0;
    let weightedQuality = 0;
    let totalUnits = 0;
    let latestTs = 0;
    let bestSubject: { courseCode: string; name: string; score: number } | null =
      null;

    for (const g of params.stuGrades) {
      const score = Number(g.totalScore) || 0;
      const gp = Number(g.gradePoint) || 0;
      const units = Math.max(1, Number(g.subject?.creditUnits) || 1);
      totalPoints += score;
      weightedQuality += gp * units;
      totalUnits += units;

      const ts = new Date(g.updatedAt).getTime();
      if (ts > latestTs) latestTs = ts;

      if (!bestSubject || score > bestSubject.score) {
        bestSubject = {
          courseCode: g.subject?.courseCode || 'SUBJ',
          name: g.subject?.name || 'Subject',
          score: Math.round(score * 100) / 100,
        };
      }
    }

    const averageScore =
      gradedSubjectsCount > 0
        ? Math.round((totalPoints / gradedSubjectsCount) * 100) / 100
        : 0;
    const gpa =
      totalUnits > 0
        ? Math.round((weightedQuality / totalUnits) * 100) / 100
        : 0;

    let cumQuality = 0;
    let cumUnits = 0;
    const cumList = params.cumulativeGrades || [];
    for (const cg of cumList) {
      cumQuality += cg.gradePoint * cg.units;
      cumUnits += cg.units;
    }
    const cgpa =
      cumUnits > 0 ? Math.round((cumQuality / cumUnits) * 100) / 100 : gpa;
    const cumulativeUnits = cumUnits > 0 ? cumUnits : totalUnits;
    const cumulativeGradedCount =
      cumList.length > 0 ? cumList.length : gradedSubjectsCount;

    // SofaScore 1.0 - 10.0 Rating derived dynamically
    const rating =
      gradedSubjectsCount === 0
        ? 0
        : params.isTertiary
        ? Math.min(
            10,
            Math.max(
              1,
              Math.round(((gpa / Math.max(1, params.gpaScaleMax)) * 10) * 10) /
                10,
            ),
          )
        : Math.min(
            10,
            Math.max(1, Math.round((averageScore / 10) * 10) / 10),
          );

    const band =
      gradedSubjectsCount > 0
        ? this.gpaCalculator.resolveGradeBand(
            averageScore,
            undefined,
            params.gpaScaleMax,
            params.institutionType,
          )
        : null;

    return {
      rank: null,
      ordinal: '—',
      previousRank: null,
      rankDelta: 0,
      isNew: false,
      studentId: params.studentId,
      fullName: params.fullName,
      matricOrAdmissionNo: params.matricOrAdmissionNo,
      avatarUrl: params.avatarUrl,
      classId: params.clsMeta?.id ?? '',
      className: params.clsMeta?.name ?? 'Unassigned',
      levelCode: params.clsMeta?.levelCode ?? null,
      combinedKey: params.clsMeta?.cohort.combinedKey ?? 'GENERAL',
      combinedLabel: params.clsMeta?.cohort.combinedLabel ?? 'General',
      departmentName: params.clsMeta?.departmentName ?? null,
      unitName: params.clsMeta?.unitName ?? null,
      averageScore,
      totalPoints: Math.round(totalPoints * 100) / 100,
      gpa,
      cgpa,
      gpaScaleMax: params.gpaScaleMax,
      totalUnits,
      cumulativeUnits,
      gradedSubjectsCount,
      enrolledSubjectsCount: params.enrolledSubjectsCount,
      cumulativeGradedCount,
      rating,
      letterGrade: band?.grade ?? '—',
      bestSubject,
      latestUpdatedAt: latestTs > 0 ? new Date(latestTs).toISOString() : null,
      isMe: false,
    };
  }

  private buildSubjectRows(
    dataset: Awaited<ReturnType<LiveRankingsService['computeSchoolDataset']>>,
    subjectId: string,
  ): LiveRankingRow[] {
    const subj = dataset.subjectsMeta.find((s) => s.id === subjectId);
    if (!subj) return [];

    const subjectGrades = dataset.grades.filter((g) => g.subjectId === subjectId);
    const gradeByStudent = new Map(subjectGrades.map((g) => [g.studentId, g]));

    const enrolledInClass = dataset.allStudentRows.filter(
      (r) => r.classId === subj.classId || gradeByStudent.has(r.studentId),
    );

    return enrolledInClass.map((baseRow) => {
      const g = gradeByStudent.get(baseRow.studentId);
      if (!g) {
        return {
          ...baseRow,
          averageScore: 0,
          totalPoints: 0,
          gpa: 0,
          gradedSubjectsCount: 0,
          enrolledSubjectsCount: 1,
          rating: 0,
          letterGrade: '—',
          bestSubject: null,
          latestUpdatedAt: null,
        };
      }
      const score = Math.round((Number(g.totalScore) || 0) * 100) / 100;
      const gp = Math.round((Number(g.gradePoint) || 0) * 100) / 100;
      const rating = Math.min(
        10,
        Math.max(1, Math.round((score / 10) * 10) / 10),
      );
      return {
        ...baseRow,
        averageScore: score,
        totalPoints: score,
        gpa: gp,
        totalUnits: subj.creditUnits ?? 0,
        gradedSubjectsCount: 1,
        enrolledSubjectsCount: 1,
        rating,
        letterGrade: g.letterGrade || 'F',
        bestSubject: {
          courseCode: subj.courseCode,
          name: subj.name,
          score,
        },
        latestUpdatedAt: new Date(g.updatedAt).toISOString(),
      };
    });
  }

  private rankRows(
    rows: LiveRankingRow[],
    useGpaPrimary: boolean,
    prevMap?: Map<string, number>,
    currentUserId?: string,
    metricMode: LiveRankingMetricMode = 'SEMESTER_GPA',
  ): LiveRankingRow[] {
    const isCgpa = useGpaPrimary && metricMode === 'CUMULATIVE_CGPA';
    const hasGradedWork = (r: LiveRankingRow) =>
      isCgpa ? r.cumulativeGradedCount > 0 : r.gradedSubjectsCount > 0;
    const primaryScore = (r: LiveRankingRow) =>
      isCgpa ? r.cgpa : useGpaPrimary ? r.gpa : r.averageScore;

    const graded = rows.filter(hasGradedWork);
    const pending = rows
      .filter((r) => !hasGradedWork(r))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const sortedGraded = [...graded].sort((a, b) => {
      if (useGpaPrimary && Math.abs(primaryScore(b) - primaryScore(a)) > 0.001) {
        return primaryScore(b) - primaryScore(a);
      }
      if (Math.abs(b.averageScore - a.averageScore) > 0.001) {
        return b.averageScore - a.averageScore;
      }
      if (Math.abs(b.totalPoints - a.totalPoints) > 0.001) {
        return b.totalPoints - a.totalPoints;
      }
      return b.gradedSubjectsCount - a.gradedSubjectsCount;
    });

    let currentRank = 0;
    let prevPrimaryVal: number | null = null;

    const rankedGraded: LiveRankingRow[] = sortedGraded.map((row, idx) => {
      const primaryVal = primaryScore(row);
      const isTied =
        prevPrimaryVal !== null && Math.abs(primaryVal - prevPrimaryVal) <= 0.001;
      if (!isTied) {
        currentRank = idx + 1;
      }
      prevPrimaryVal = primaryVal;

      const prevRank = prevMap?.get(row.studentId) ?? null;
      const hasPrev = Boolean(prevMap && prevMap.size > 0);
      const isNew = hasPrev && prevRank === null;
      const rankDelta = prevRank !== null ? prevRank - currentRank : 0;

      return {
        ...row,
        rank: currentRank,
        ordinal: this.rankingCalculator.formatOrdinal(currentRank),
        previousRank: prevRank,
        rankDelta,
        isNew,
        isMe: Boolean(currentUserId && row.studentId === currentUserId),
      };
    });

    const rankedPending: LiveRankingRow[] = pending.map((row) => ({
      ...row,
      rank: null,
      ordinal: '—',
      previousRank: null,
      rankDelta: 0,
      isNew: false,
      isMe: Boolean(currentUserId && row.studentId === currentUserId),
    }));

    return [...rankedGraded, ...rankedPending];
  }
}
