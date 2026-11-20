import { Injectable, NestMiddleware } from '@nestjs/common';
import { extractUserId } from '../utils/user-extractor.util.js';

/**
 * Global UserContextMiddleware
 * Extracts authenticated JWT user & active tenant (`schoolId`) context first,
 * falling back to explicit user extraction only when no Bearer JWT is present.
 */
@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const authHeader: string | undefined = req?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
          );
          const tokenUserId = payload.sub || payload.id;
          const tokenSchoolId = payload.activeTenantId || payload.schoolId;
          req.user = {
            ...req.user,
            id: tokenUserId || req.user?.id,
            sub: tokenUserId || req.user?.sub,
            email: payload.email || req.user?.email,
            role: payload.role || req.user?.role || 'STUDENT',
            schoolId: tokenSchoolId || req.user?.schoolId,
            activeTenantId: tokenSchoolId || req.user?.activeTenantId,
            membershipId: payload.membershipId || req.user?.membershipId,
            mustChangePassword: !!payload.mustChangePassword,
          };
          if (tokenUserId) {
            req.userId = String(tokenUserId).trim();
          }
        }
      } catch {}
    }

    const userId = extractUserId(req);
    if (userId) {
      req.userId = userId;
      if (!req.user) {
        req.user = { id: userId, sub: userId };
      } else if (!req.user.id) {
        req.user.id = userId;
      }
    }

    next();
  }
}
