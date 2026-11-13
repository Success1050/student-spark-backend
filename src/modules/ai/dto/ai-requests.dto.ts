export class UploadNoteAiDto {
  title: string;
  userId: string;
  file: string; // base64 PDF or image
  mimeType?: string;
}

export class GenerateStudyPlanAiDto {
  userId: string;
  duration: number | string;
  hours?: number | string;
  studyHours?: string | number;
  examDate?: string;
  planName?: string;
  subjects?: string[];
  notes?: string[];
  noteIds?: string[];
  aiOptions?: {
    includeRevision?: boolean;
    avoidWeekends?: boolean;
    includeBreaks?: boolean;
  };
}

export class GeneratePqFromNotesAiDto {
  noteIds: string[];
  userId: string;
}

export class GenerateQuizFromNoteAiDto {
  noteId: string;
  userId: string;
}

export class UploadPastQuestionAiDto {
  title: string;
  userId: string;
  file: string;
}

export class GenerateMotivationAiDto {
  userId: string;
}

export class AiTutorChatDto {
  question: string;
  noteId?: string;
  bookId?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  contextText?: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode?: 'EXPLAIN_SIMPLE' | 'DEEP_DIVE' | 'TEST_ME' | 'EXAM_TIPS' | 'GENERAL';
  userId?: string;
}
