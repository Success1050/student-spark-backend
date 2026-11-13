import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { extractUserId } from '../utils/user-extractor.util.js';

export interface RequestUser {
  id: string;
  email?: string;
  role?: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN';
  schoolId?: string | null;
  plan?: 'free' | 'premium' | 'pro';
}

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (data === 'id') {
      return user?.id || extractUserId(request);
    }
    return data ? user?.[data] : user;
  },
);
