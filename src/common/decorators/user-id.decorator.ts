import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { extractUserId } from '../utils/user-extractor.util.js';

/**
 * Global `@UserId()` parameter decorator for NestJS route handlers.
 * Extracts the user ID automatically from:
 * - Query parameter (`userId`, `user_id`)
 * - Request body (`userId`, `user_id`)
 * - `Authorization: Bearer <JWT>` token header (sub / id claim)
 * - `x-user-id` HTTP header
 * - Attached `req.user` or `req.userId`
 *
 * Example:
 *   @Get('overview')
 *   getOverview(@UserId() userId: string) { ... }
 */
export const UserId = createParamDecorator(
  (explicitField: string | undefined, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const explicitValue = explicitField
      ? request.query?.[explicitField] ?? request.body?.[explicitField]
      : request.query?.userId ?? request.body?.userId;
    return extractUserId(request, explicitValue);
  },
);
