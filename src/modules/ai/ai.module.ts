import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { OpenAiService } from './services/openai.service.js';
import { PdfParserService } from './services/pdf-parser.service.js';
import { NoteSummarizerService } from './services/note-summarizer.service.js';
import { StudyPlanAiService } from './services/study-plan-ai.service.js';
import { QuizGeneratorAiService } from './services/quiz-generator-ai.service.js';
import { PqPredictorAiService } from './services/pq-predictor-ai.service.js';
import { MotivationAiService } from './services/motivation-ai.service.js';
import { ReportCardRemarksAiService } from './services/report-card-remarks-ai.service.js';
import { AiTutorService } from './services/ai-tutor.service.js';
import { AiProcessingProcessor } from './queues/ai-processing.processor.js';
import { MarketplaceModule } from '../marketplace/marketplace.module.js';

@Module({
  imports: [MarketplaceModule],
  controllers: [AiController],
  providers: [
    OpenAiService,
    PdfParserService,
    NoteSummarizerService,
    StudyPlanAiService,
    QuizGeneratorAiService,
    PqPredictorAiService,
    MotivationAiService,
    ReportCardRemarksAiService,
    AiTutorService,
    AiProcessingProcessor,
  ],
  exports: [
    OpenAiService,
    PdfParserService,
    NoteSummarizerService,
    StudyPlanAiService,
    QuizGeneratorAiService,
    PqPredictorAiService,
    MotivationAiService,
    ReportCardRemarksAiService,
    AiTutorService,
  ],
})
export class AiModule {}
