import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from './openai.service.js';

/**
 * Generates personalized Teacher & Principal terminal report card remarks
 * based on a student's subject scores, positions, and attendance.
 * Remarks are saved as drafts so Teachers and Principals can edit them before publishing.
 */
@Injectable()
export class ReportCardRemarksAiService {
  private readonly logger = new Logger(ReportCardRemarksAiService.name);

  constructor(private readonly openAiService: OpenAiService) {}

  async draftReportCardRemarks(params: {
    studentName: string;
    overallPercentage: number;
    classPosition: string;
    attendancePercentage: number;
    strongestSubjects: string[];
    weakestSubjects: string[];
    isTertiary?: boolean;
    gpa?: number;
    cgpa?: number;
    gpaScaleMax?: number;
    standing?: string;
    tone?: 'ENCOURAGING' | 'FORMAL' | 'CONSTRUCTIVE';
  }) {
    this.logger.log(`Drafting editable AI report card remarks for ${params.studentName}`);

    const strongestText =
      params.strongestSubjects.length > 0
        ? params.strongestSubjects.join(', ')
        : 'core coursework';
    const weakestText =
      params.weakestSubjects.length > 0
        ? params.weakestSubjects.join(', ')
        : 'elective topics';

    const fallbackTeacher = params.isTertiary
      ? `Demonstrated solid mastery in ${strongestText}${
          params.weakestSubjects.length > 0
            ? `; dedicate extra tutorial hours to ${weakestText}`
            : ''
        }. Attendance is ${Math.round(params.attendancePercentage)}%.`
      : `An impressive performance in ${strongestText}. With consistent practice in ${weakestText}, even stronger results lie ahead.`;

    const fallbackPrincipal = params.isTertiary
      ? `${params.standing || 'Satisfactory'} standing with ${(params.gpa ?? 0).toFixed(2)}/${params.gpaScaleMax ?? 5} GPA (${params.overallPercentage.toFixed(1)}% mean). Keep up disciplined academic focus.`
      : `Good term overall achieving ${params.classPosition || 'merit'} position with ${params.overallPercentage.toFixed(1)}% average and ${Math.round(params.attendancePercentage)}% attendance.`;

    if (!process.env.OPENAI_API_KEY) {
      return {
        teacherRemarkDraft: fallbackTeacher,
        principalRemarkDraft: fallbackPrincipal,
        isEditable: true,
        source: 'TEMPLATE',
      };
    }

    try {
      const role1 = params.isTertiary ? 'Academic Adviser / Lecturer' : 'Form / Class Teacher';
      const role2 = params.isTertiary ? 'HOD / Dean' : 'Principal / Head Teacher';
      const tone = params.tone || 'ENCOURAGING';

      const prompt = [
        `Write concise, authentic Nigerian & international school report card remarks (${tone} tone) for student "${params.studentName}".`,
        `Institution Mode: ${params.isTertiary ? 'Tertiary (University / Polytechnic)' : 'Primary / Secondary'}.`,
        `Metrics: Overall Average ${params.overallPercentage.toFixed(1)}%, Attendance ${Math.round(params.attendancePercentage)}%, ${
          params.isTertiary
            ? `Semester GPA ${(params.gpa ?? 0).toFixed(2)}/${params.gpaScaleMax ?? 5.0}, CGPA ${(params.cgpa ?? 0).toFixed(2)}, Standing: ${params.standing || 'Good Standing'}`
            : `Class Position: ${params.classPosition || 'N/A'}`
        }.`,
        `Strongest Subjects: ${strongestText}.`,
        `Subjects Needing Improvement: ${weakestText}.`,
        `Return ONLY valid JSON: { "teacherRemarkDraft": "...", "principalRemarkDraft": "..." }. Keep each remark 1-2 crisp sentences (under 180 characters) appropriate for ${role1} and ${role2}.`,
      ].join('\n');

      const raw = await this.openAiService.chatCompletion({
        systemPrompt: 'You are an experienced Academic Registrar & Educator drafting personalized report card remarks.',
        userPrompt: prompt,
        temperature: 0.45,
        maxTokens: 260,
      });

      const parsed = this.openAiService.cleanJsonOutput<{
        teacherRemarkDraft?: string;
        principalRemarkDraft?: string;
      }>(raw, {});

      if (parsed.teacherRemarkDraft && parsed.principalRemarkDraft) {
        return {
          teacherRemarkDraft: String(parsed.teacherRemarkDraft).trim(),
          principalRemarkDraft: String(parsed.principalRemarkDraft).trim(),
          isEditable: true,
          source: 'AI',
        };
      }
    } catch (err) {
      this.logger.warn(`AI remark generation fallback triggered: ${String(err)}`);
    }

    return {
      teacherRemarkDraft: fallbackTeacher,
      principalRemarkDraft: fallbackPrincipal,
      isEditable: true,
      source: 'TEMPLATE',
    };
  }
}
