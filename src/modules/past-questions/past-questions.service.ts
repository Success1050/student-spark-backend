import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InstitutionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { OpenAiService } from '../ai/services/openai.service.js';
import { StorageService } from '../storage/storage.service.js';

export interface DepartmentalPqStep {
  stepNumber: number;
  title: string;
  explanation: string;
  formulaOrKeyPoint?: string;
}

export interface DepartmentalPqSolution {
  overview: string;
  steps: DepartmentalPqStep[];
  finalAnswer: string;
  markingSchemeTips: string[];
  commonMistakes: string[];
  generatedAt: string;
  source: 'AI' | 'OFFLINE_FALLBACK';
}

/**
 * Replaces Supabase 'practice_question_sets', 'past_questions', and 'past_question_topics' queries
 * and adds Day 15B 10-Year Departmental Past Question Bank + Step-by-Step AI Solutions + Offline Bundle.
 */
@Injectable()
export class PastQuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAi: OpenAiService,
    private readonly storage: StorageService,
  ) {}

  private formatPracticeSet(set: {
    id: string;
    userId: string;
    noteId: string | null;
    noteIds: string[];
    title: string;
    courseCode: string;
    totalQuestions: number;
    questions: unknown;
    completed: boolean;
    score: number | null;
    totalAttempted: number;
    createdAt: Date;
  }) {
    return {
      ...set,
      user_id: set.userId,
      note_id: set.noteId,
      note_ids: set.noteIds,
      course_code: set.courseCode,
      total_questions: set.totalQuestions,
      questions_data: set.questions,
      total_attempted: set.totalAttempted,
      created_at: set.createdAt.toISOString(),
    };
  }

  async findPracticeSetsByUser(userId: string) {
    if (!userId) return [];
    const sets = await this.prisma.practiceQuestionSet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return sets.map((s) => this.formatPracticeSet(s));
  }

  async findOnePracticeSet(setId: string, userId?: string) {
    const set = await this.prisma.practiceQuestionSet.findFirst({
      where: {
        id: String(setId),
        ...(userId ? { userId } : {}),
      },
    });
    if (!set) {
      throw new NotFoundException('Practice question set not found');
    }
    return this.formatPracticeSet(set);
  }

  async findAllByUser(userId: string) {
    if (!userId) return [];
    const pastQuestions = await this.prisma.pastQuestion.findMany({
      where: { userId },
      include: { topics: true },
      orderBy: { createdAt: 'desc' },
    });
    return pastQuestions.map((pq) => ({
      ...pq,
      user_id: pq.userId,
      file_url: pq.fileUrl,
      past_question_topics: pq.topics,
      created_at: pq.createdAt.toISOString(),
    }));
  }

  // ============================================================================
  // DAY 15B: 10-YEAR DEPARTMENTAL PAST QUESTION BANK & AI STEP-BY-STEP SOLVER
  // ============================================================================

  private formatDepartmentalPq(row: any) {
    return {
      id: row.id,
      schoolId: row.schoolId,
      schoolName: row.school?.name || 'National Inter-Campus Bank',
      departmentId: row.departmentId,
      departmentName: row.department?.name || row.departmentName,
      facultyName: row.facultyName,
      institutionType: row.institutionType,
      levelCode: row.levelCode,
      courseCode: row.courseCode,
      courseTitle: row.courseTitle,
      academicYear: row.academicYear,
      semester: row.semester,
      examType: row.examType,
      questionText: row.questionText,
      fileUrl: this.storage.getAccessiblePdfUrl(row.fileUrl),
      aiSolution: (row.aiSolutionJson as DepartmentalPqSolution | null) || null,
      hasAiSolution: Boolean(row.aiSolutionJson),
      isVerifiedByLecturer: row.isVerifiedByLecturer,
      uploadedByName: row.uploadedBy?.fullName || 'Department Archive',
      downloadCount: row.downloadCount,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listDepartmentalPqs(
    userId: string,
    query: {
      schoolScope?: 'MY_SCHOOL' | 'ALL_UNIVERSITIES';
      departmentName?: string;
      courseCode?: string;
      levelCode?: string;
      academicYear?: string;
      semester?: string;
      search?: string;
    },
  ) {
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            studentProfile: { include: { department: true } },
            school: true,
          },
        })
      : null;

    const useSchoolScope =
      query.schoolScope !== 'ALL_UNIVERSITIES' && Boolean(user?.schoolId);

    const where: any = {};
    if (useSchoolScope && user?.schoolId) {
      where.OR = [{ schoolId: user.schoolId }, { schoolId: null }];
    }
    if (query.departmentName?.trim()) {
      where.departmentName = {
        contains: query.departmentName.trim(),
        mode: 'insensitive',
      };
    }
    if (query.courseCode?.trim()) {
      where.courseCode = {
        contains: query.courseCode.trim(),
        mode: 'insensitive',
      };
    }
    if (query.levelCode?.trim()) {
      where.levelCode = {
        contains: query.levelCode.trim(),
        mode: 'insensitive',
      };
    }
    if (query.academicYear?.trim()) {
      where.academicYear = query.academicYear.trim();
    }
    if (query.semester?.trim()) {
      where.semester = { contains: query.semester.trim(), mode: 'insensitive' };
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { courseCode: { contains: q, mode: 'insensitive' } },
            { courseTitle: { contains: q, mode: 'insensitive' } },
            { questionText: { contains: q, mode: 'insensitive' } },
            { departmentName: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const items = await this.prisma.departmentalPastQuestion.findMany({
      where,
      include: {
        school: { select: { id: true, name: true, institutionType: true } },
        department: { select: { id: true, name: true, code: true } },
        uploadedBy: { select: { id: true, fullName: true } },
      },
      orderBy: [{ academicYear: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    const yearsSet = new Set<string>();
    const courseSet = new Set<string>();
    for (const item of items) {
      yearsSet.add(item.academicYear);
      courseSet.add(item.courseCode);
    }

    return {
      items: items.map((r) => this.formatDepartmentalPq(r)),
      yearsAvailable: Array.from(yearsSet).sort((a, b) => (a < b ? 1 : -1)),
      coursesAvailable: Array.from(courseSet).sort(),
      userDepartment: user?.studentProfile?.department?.name || null,
      userLevel: user?.studentProfile?.level || null,
      continuityMode: user?.school?.academicContinuityMode || 'ACTIVE',
    };
  }

  async uploadDepartmentalPq(
    userId: string,
    dto: {
      courseCode: string;
      courseTitle: string;
      departmentName?: string;
      facultyName?: string;
      levelCode?: string;
      academicYear: string;
      semester?: string;
      examType?: string;
      questionText?: string;
      fileBase64?: string;
      fileName?: string;
      fileUrl?: string;
      institutionType?: InstitutionType;
      isSharedPublicly?: boolean;
    },
  ) {
    const hasFile = Boolean(dto.fileBase64?.trim() || dto.fileUrl?.trim());
    if (!dto.courseCode?.trim() || !dto.courseTitle?.trim() || !dto.academicYear?.trim() || (!dto.questionText?.trim() && !hasFile)) {
      throw new BadRequestException(
        'Course code, course title, academic year, and either question text or an attached PDF are required.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        school: true,
        studentProfile: { include: { department: true } },
        teacherProfile: { include: { department: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    let resolvedFileUrl: string | null = dto.fileUrl?.trim() || null;
    if (dto.fileBase64) {
      const cleanBase64 = dto.fileBase64.includes('base64,')
        ? dto.fileBase64.split('base64,')[1]
        : dto.fileBase64;
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.byteLength > 0) {
        const safeName = (dto.fileName || `${dto.courseCode}_${dto.academicYear}.pdf`).replace(
          /[^a-zA-Z0-9._-]/g,
          '_',
        );
        const uploaded = await this.storage.uploadPdfBuffer(
          buf,
          `${randomUUID().slice(0, 8)}_${safeName}`,
          'past-questions',
        );
        resolvedFileUrl = uploaded.publicUrl;
      }
    }

    const roleUpper = String(user.role).toUpperCase();
    const isStaff = roleUpper === 'TEACHER' || roleUpper === 'SCHOOL_ADMIN' || roleUpper === 'SUPER_ADMIN';

    const deptName =
      dto.departmentName?.trim() ||
      user.studentProfile?.department?.name ||
      user.teacherProfile?.department?.name ||
      'General Studies';

    const resolvedQuestionText =
      dto.questionText?.trim() ||
      `Uploaded Past Question Paper: ${dto.fileName?.trim() || `${dto.courseCode.trim().toUpperCase()} (${dto.academicYear.trim()})`}`;

    const created = await this.prisma.departmentalPastQuestion.create({
      data: {
        schoolId: dto.isSharedPublicly ? null : user.schoolId || null,
        departmentId: user.studentProfile?.departmentId || user.teacherProfile?.departmentId || null,
        institutionType: dto.institutionType || user.school?.institutionType || InstitutionType.UNIVERSITY,
        facultyName: dto.facultyName?.trim() || null,
        departmentName: deptName,
        levelCode: dto.levelCode?.trim().toUpperCase() || user.studentProfile?.level || '100L',
        courseCode: dto.courseCode.trim().toUpperCase(),
        courseTitle: dto.courseTitle.trim(),
        academicYear: dto.academicYear.trim(),
        semester: dto.semester?.trim() || 'First Semester',
        examType: dto.examType?.trim() || 'Semester Exam',
        questionText: resolvedQuestionText,
        fileUrl: resolvedFileUrl,
        isVerifiedByLecturer: isStaff,
        verifiedById: isStaff ? userId : null,
        uploadedById: userId,
      },
      include: {
        school: { select: { id: true, name: true, institutionType: true } },
        department: { select: { id: true, name: true, code: true } },
        uploadedBy: { select: { id: true, fullName: true } },
      },
    });

    return this.formatDepartmentalPq(created);
  }

  async solveDepartmentalPqWithAi(
    pqId: string,
    forceRegenerate = false,
  ) {
    const pq = await this.prisma.departmentalPastQuestion.findUnique({
      where: { id: pqId },
    });
    if (!pq) {
      throw new NotFoundException('Departmental past question not found.');
    }

    if (pq.aiSolutionJson && !forceRegenerate) {
      return {
        cached: true,
        id: pq.id,
        solution: pq.aiSolutionJson as unknown as DepartmentalPqSolution,
      };
    }

    const fallbackSolution: DepartmentalPqSolution = {
      overview: `Structured examination walkthrough for ${pq.courseCode} (${pq.courseTitle} — ${pq.academicYear}).`,
      steps: [
        {
          stepNumber: 1,
          title: 'Identify Core Concepts & Marking Requirements',
          explanation: `Break down every clause in the ${pq.examType} prompt for ${pq.courseCode}. Define key technical terms cleanly and state known equations or statutory principles before substituting values.`,
          formulaOrKeyPoint: `Course: ${pq.courseCode} • Level: ${pq.levelCode}`,
        },
        {
          stepNumber: 2,
          title: 'Develop Systematic Step-by-Step Solution',
          explanation:
            'Present each derivation, algorithm trace, or analytical argument in numbered sub-steps so examiners can award method marks even on intermediate lines.',
        },
        {
          stepNumber: 3,
          title: 'Verify Units, Edge Cases & Conclusion',
          explanation:
            'Check dimensional consistency, boundary conditions, and write a clear concluding summary statement directly answering every part (a, b, c) of the question.',
        },
      ],
      finalAnswer:
        'Review the structured steps above and cross-check with your lecturer verified marking scheme.',
      markingSchemeTips: [
        'State all definitions, theorems, and units clearly at the start for full method marks.',
        'Label diagrams or flowcharts neatly where applicable.',
      ],
      commonMistakes: [
        'Skipping intermediate substitution steps or forgetting standard SI/computational units.',
      ],
      generatedAt: new Date().toISOString(),
      source: 'OFFLINE_FALLBACK',
    };

    let finalSolution: DepartmentalPqSolution = fallbackSolution;
    const hasOpenAiKey =
      Boolean(process.env.OPENAI_API_KEY) &&
      process.env.OPENAI_API_KEY !== 'missing-openai-key';

    if (hasOpenAiKey) {
      try {
        const raw = await this.openAi.chatCompletion({
          systemPrompt:
            'You are a top Nigerian University Senior Lecturer & Chief Examiner. Provide a crystal-clear, rigorous step-by-step model solution with Nigerian university marking-guide precision. Return strictly valid JSON with shape: {"overview": string, "steps": [{"stepNumber": number, "title": string, "explanation": string, "formulaOrKeyPoint": string}], "finalAnswer": string, "markingSchemeTips": string[], "commonMistakes": string[]}. No markdown code fences.',
          userPrompt: `Course: ${pq.courseCode} - ${pq.courseTitle} (${pq.levelCode}, ${pq.departmentName}, ${pq.academicYear} ${pq.semester} ${pq.examType})\n\nPast Question:\n${pq.questionText}`,
          temperature: 0.3,
          maxTokens: 1600,
        });

        const parsed = this.openAi.cleanJsonOutput<Partial<DepartmentalPqSolution>>(
          raw,
          {},
        );
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0 && parsed.finalAnswer) {
          finalSolution = {
            overview: parsed.overview || fallbackSolution.overview,
            steps: parsed.steps.map((st, idx) => ({
              stepNumber: Number(st.stepNumber) || idx + 1,
              title: String(st.title || `Step ${idx + 1}`),
              explanation: String(st.explanation || ''),
              ...(st.formulaOrKeyPoint ? { formulaOrKeyPoint: String(st.formulaOrKeyPoint) } : {}),
            })),
            finalAnswer: String(parsed.finalAnswer),
            markingSchemeTips: Array.isArray(parsed.markingSchemeTips)
              ? parsed.markingSchemeTips.map(String)
              : fallbackSolution.markingSchemeTips,
            commonMistakes: Array.isArray(parsed.commonMistakes)
              ? parsed.commonMistakes.map(String)
              : fallbackSolution.commonMistakes,
            generatedAt: new Date().toISOString(),
            source: 'AI',
          };
        }
      } catch {
        finalSolution = fallbackSolution;
      }
    }

    await this.prisma.departmentalPastQuestion.update({
      where: { id: pq.id },
      data: {
        aiSolutionJson: finalSolution as unknown as object,
      },
    });

    return {
      cached: false,
      id: pq.id,
      solution: finalSolution,
    };
  }

  async verifyDepartmentalPq(actorId: string, pqId: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    const roleUpper = String(actor?.role || '').toUpperCase();
    if (!['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(roleUpper)) {
      throw new ForbiddenException('Only Lecturers/Teachers or School Admins can verify past questions.');
    }

    const updated = await this.prisma.departmentalPastQuestion.update({
      where: { id: pqId },
      data: {
        isVerifiedByLecturer: true,
        verifiedById: actorId,
      },
    });

    return { success: true, id: updated.id, isVerifiedByLecturer: true };
  }

  async getOfflinePqBundle(userId: string, courseCode?: string) {
    const res = await this.listDepartmentalPqs(userId, {
      ...(courseCode ? { courseCode } : {}),
    });

    const ids = res.items.map((i) => i.id);
    if (ids.length > 0) {
      await this.prisma.departmentalPastQuestion.updateMany({
        where: { id: { in: ids } },
        data: { downloadCount: { increment: 1 } },
      });
    }

    return {
      syncedAt: new Date().toISOString(),
      totalQuestions: res.items.length,
      yearsCovered: res.yearsAvailable,
      coursesCovered: res.coursesAvailable,
      continuityMode: res.continuityMode,
      bundle: res.items,
    };
  }
}
