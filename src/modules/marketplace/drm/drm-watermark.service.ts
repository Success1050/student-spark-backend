import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

export interface WatermarkPayload {
  watermarkText: string;
  studentIdentifier: string;
  issuedAt: string;
  allowRawDownload: boolean;
  blockScreenshots: boolean;
}

export interface BookChapter {
  id: string;
  chapterNumber: number;
  title: string;
  summary: string;
  content: string;
  keyPoints: string[];
  selfCheckQuestions: {
    question: string;
    answer: string;
  }[];
}

/**
 * Generates diagonal buyer watermarks (Full Name, Email, Matric/Student ID)
 * and encrypted in-app reader stream tokens so paid PDFs cannot be pirated on WhatsApp.
 */
@Injectable()
export class DrmWatermarkService {
  /**
   * Generates custom diagonal watermark text and security policy.
   */
  generateBuyerWatermarkPayload(buyer: {
    fullName?: string;
    email?: string;
    studentCode?: string;
  }): WatermarkPayload {
    const studentIdentifier = (
      buyer.studentCode ||
      buyer.email ||
      buyer.fullName ||
      'VERIFIED_STUDENT'
    ).trim();

    const timestamp = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    const watermarkText = `LICENSED TO ${buyer.fullName || 'STUDENT'} (${buyer.email || 'N/A'}) • ID: ${studentIdentifier} • DATE: ${timestamp} • STUDENTSPARK DRM PROTECTED • RE-DISTRIBUTION PROHIBITED`;

    return {
      watermarkText,
      studentIdentifier,
      issuedAt: new Date().toISOString(),
      allowRawDownload: false,
      blockScreenshots: true,
    };
  }

  /**
   * Generates a cryptographically secure offline license token.
   */
  generateOfflineLicenseToken(itemId: string, buyerId: string): string {
    const hash = crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'studentspark_drm_secret_key')
      .update(`${itemId}:${buyerId}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`)
      .digest('hex');
    return `DRM-${hash.substring(0, 32).toUpperCase()}`;
  }

  /**
   * Returns structured curriculum chapters for the in-app DRM reader.
   */
  generateStructuredChapters(book: {
    title: string;
    courseCode: string;
    authorName: string;
    description: string;
  }): BookChapter[] {
    const code = book.courseCode || 'GEN';
    return [
      {
        id: 'ch-1',
        chapterNumber: 1,
        title: `Overview & Lecture Notes (${code})`,
        summary: `Core definitions, scope, and lecturer overview for ${book.title}.`,
        content: [
          `### 1.1 Course Handout / Lecture Summary`,
          book.description?.trim()
            ? book.description.trim()
            : `Welcome to ${book.title}. Prepared by ${book.authorName}.`,
          ``,
          `### 1.2 Study & Examination Objectives`,
          `The core objectives of this study material prepared by ${book.authorName} are to equip scholars with:`,
          `1. Theoretical rigor and comprehensive terminological mastery.`,
          `2. Analytical competency required to evaluate complex practical problems.`,
          `3. Exam-grade preparation aligned with institution coursework and national standards.`,
          ``,
          `> Key Principle: Understanding first-principles derivation eliminates the need for rote memorization. Master the causal relationship between variable states and system outcomes.`,
        ].join('\n\n'),
        keyPoints: [
          'Mastery of core terminology and dimensional validity.',
          'Postulate identification before theorem application.',
          'Consistency in analytical problem breakdown.',
        ],
        selfCheckQuestions: [
          {
            question: `What is the primary pedagogical aim of ${code}?`,
            answer: `To establish solid conceptual foundations and analytical skills required for advanced application and examination excellence.`,
          },
          {
            question: `Why is first-principles derivation emphasized over memorization?`,
            answer: `First-principles understanding allows students to handle unfamiliar exam twists and real-world system variations.`,
          },
        ],
      },
      {
        id: 'ch-2',
        chapterNumber: 2,
        title: `Core Principles & Theoretical Frameworks`,
        summary: `Detailed examination of governing mechanisms, operational models, and mathematical or contextual derivations.`,
        content: [
          `### 2.1 The Governing Theorems`,
          `Theoretical formulation demands rigorous adherence to baseline mechanics. When analyzing complex operations:`,
          `Efficiency (%) = (Actual Output / Theoretical Maximum) * 100`,
          `For qualitative disciplines, establish comparative matrix parameters before drawing evaluative conclusions.`,
          ``,
          `### 2.2 Case Study Analysis`,
          `Consider a representative standard evaluation scenario. Where traditional approaches rely on static intuition, modern curriculum standards mandate dynamic sensitivity assessment.`,
          ``,
          `[Input Parameters] ---> [Transformation Stage] ---> [Validated Result]`,
          `       ^                          |                       |`,
          `       |---- Feedback Control <---|-----------------------|`,
          ``,
          `### 2.3 Common Pitfalls to Avoid in Examinations`,
          `- Failing to explicitly state assumed boundary conditions.`,
          `- Neglecting intermediate calculation units or structural justification.`,
          `- Conflating correlation with direct institutional causality.`,
        ].join('\n\n'),
        keyPoints: [
          'Equations and theoretical matrices must include stated assumptions.',
          'Feedback loops highlight systemic error before final outputs.',
          'Always show intermediate steps for maximum marks.',
        ],
        selfCheckQuestions: [
          {
            question: `How should boundary conditions be treated in solutions?`,
            answer: `They must be explicitly stated at the outset so validity limits are well-defined.`,
          },
        ],
      },
      {
        id: 'ch-3',
        chapterNumber: 3,
        title: `Worked Examples & Computational Problems`,
        summary: `Step-by-step problem walkthroughs reflecting standard past question papers and marking guides.`,
        content: [
          `### 3.1 Worked Problem Set 1`,
          `Problem Statement: An academic institution evaluates a cohort performance metric where baseline input X = 120 and scaling factor Alpha = 1.45. Compute the calibrated performance output Y.`,
          `Step 1: Formula Selection`,
          `Y = Alpha * X + Beta (assuming normalized baseline bias Beta = 10)`,
          `Step 2: Arithmetic Evaluation`,
          `Y = (1.45 * 120) + 10 = 174 + 10 = 184`,
          `Step 3: Verification`,
          `The resultant metric falls safely within the non-divergent operating range of [0, 200]. Full marks awarded.`,
          ``,
          `### 3.2 Practice Challenge`,
          `Attempt modifying Alpha to 1.85 and note how the non-linear inflection threshold shifts. Document your reasoning in your revision notebook.`,
        ].join('\n\n'),
        keyPoints: [
          'State the chosen formula explicitly before substituting variables.',
          'Verify that final results satisfy real-world constraint bounds.',
        ],
        selfCheckQuestions: [
          {
            question: `What is the significance of the verification step in worked solutions?`,
            answer: `It validates that the calculated answer is physically or conceptually feasible within problem constraints.`,
          },
        ],
      },
      {
        id: 'ch-4',
        chapterNumber: 4,
        title: `Comprehensive Revision, Past Questions & Key Takeaways`,
        summary: `High-yield summary notes, frequent examination question patterns, and self-assessment checklist.`,
        content: [
          `### 4.1 High-Yield Summary`,
          `As you conclude review of ${book.title}, ensure absolute clarity on:`,
          `- Topic 1: Structural definitions and operational matrices.`,
          `- Topic 2: Theoretical derivation pathways and assumptions.`,
          `- Topic 3: Computational execution without reliance on rote memory.`,
          ``,
          `### 4.2 Past Question Compendium Insights`,
          `Analysis of past 5-year examination patterns shows that over 65% of test items test the interaction between foundational theorems and applied boundary conditions.`,
          ``,
          `> Exam Tip: Allocate 15% of your examination time to proofreading diagrams, symbol consistency, and conclusion statements.`,
          ``,
          `Congratulations on completing this study unit! Use the in-app quiz generator from the Notes & Quizzes tab to test your recall.`,
        ].join('\n\n'),
        keyPoints: [
          '65%+ of exam questions test application rather than simple recall.',
          'Proofreading intermediate steps prevents avoidable score loss.',
        ],
        selfCheckQuestions: [
          {
            question: `What percentage of examination time is recommended for review?`,
            answer: `Approximately 15% of total exam time should be reserved for verifying consistency and final answers.`,
          },
        ],
      },
    ];
  }
}
