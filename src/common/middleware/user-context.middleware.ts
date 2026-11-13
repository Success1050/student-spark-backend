import { Injectable, NestMiddleware } from '@nestjs/common';
import { extractUserId } from '../utils/user-extractor.util.js';

/**
 * Global UserContextMiddleware
 * Automatically extracts and attaches `userId` and full `user` tenant/membership context on every incoming HTTP request.
 */
@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const userId = extractUserId(req);
    if (userId) {
      req.userId = userId;
      if (!req.user) {
        req.user = { id: userId, sub: userId };
      } else if (!req.user.id) {
        req.user.id = userId;
      }
    }

    // Decode JWT payload if present to populate role, schoolId, membershipId
    const authHeader: string | undefined = req?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64').toString('utf8'),
          );
          req.user = {
            ...req.user,
            id: payload.sub || payload.id || req.user?.id,
            sub: payload.sub || payload.id || req.user?.id,
            email: payload.email || req.user?.email,
            role: payload.role || req.user?.role || 'STUDENT',
            schoolId:
              payload.activeTenantId ||
              payload.schoolId ||
              req.user?.schoolId,
            activeTenantId:
              payload.activeTenantId ||
              payload.schoolId ||
              req.user?.activeTenantId,
            membershipId: payload.membershipId || req.user?.membershipId,
            mustChangePassword: !!payload.mustChangePassword,
          };
        }
      } catch {}
    }

    next();
  }
}
