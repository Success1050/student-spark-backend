import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { envConfig } from './config/index.js';
import { PrismaModule } from './database/prisma.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { UsageTrackingModule } from './modules/usage-tracking/usage-tracking.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { NotesModule } from './modules/notes/notes.module.js';
import { QuizzesModule } from './modules/quizzes/quizzes.module.js';
import { PastQuestionsModule } from './modules/past-questions/past-questions.module.js';
import { StudyPlansModule } from './modules/study-plans/study-plans.module.js';
import { TrackerModule } from './modules/tracker/tracker.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { ReferralsWalletModule } from './modules/referrals-wallet/referrals-wallet.module.js';
import { MarketplaceModule } from './modules/marketplace/marketplace.module.js';
import { SchoolsModule } from './modules/schools/schools.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { AssessmentsGradingModule } from './modules/assessments-grading/assessments-grading.module.js';
import { CommunitiesModule } from './modules/communities/communities.module.js';
import { GamesModule } from './modules/games/games.module.js';
import { SuperAdminModule } from './modules/super-admin/super-admin.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { TeacherModule } from './modules/teacher/teacher.module.js';
import { CourseRepModule } from './modules/course-rep/course-rep.module.js';
import { SugModule } from './modules/sug/sug.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { UserContextMiddleware } from './common/middleware/user-context.middleware.js';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [envConfig],
    }),
    ScheduleModule.forRoot(),
    // Core Global Infrastructure
    PrismaModule,
    StorageModule,
    UsageTrackingModule,
    NotificationsModule,

    // Merged Node.js AI & OCR Engine (from studentspark_backend)
    AiModule,

    // Core Student Companion Modules (migrated from Supabase)
    AuthModule,
    UsersModule,
    NotesModule,
    QuizzesModule,
    PastQuestionsModule,
    StudyPlansModule,
    TrackerModule,
    SubscriptionsModule,

    // StudentSpark 2.0 Growth, Multi-Tenancy & School ERP/LMS Modules
    ReferralsWalletModule,
    MarketplaceModule,
    SchoolsModule,
    AttendanceModule,
    AssessmentsGradingModule,
    CommunitiesModule,
    GamesModule,
    SuperAdminModule,
    AuditLogModule,
    TeacherModule,
    CourseRepModule,
    SugModule,
    FinanceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(UserContextMiddleware).forRoutes('*');
  }
}
