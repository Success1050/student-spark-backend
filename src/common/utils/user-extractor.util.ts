/**
 * Global User ID Extraction Utility
 * Extracts user ID with complete priority fallback:
 * 1. Explicit argument (passed explicitly from query or body)
 * 2. Already resolved `req.userId`
 * 3. `req.user?.id` or `req.user?.sub` (from auth guards or token verification)
 * 4. `x-user-id` HTTP request header
 * 5. Query parameter `userId` or `user_id`
 * 6. Body field `userId` or `user_id`
 * 7. `Authorization: Bearer <JWT>` header (decoding `sub` or `id`)
 */
export function extractUserId(req: any, explicit?: string): string {
  if (
    explicit &&
    String(explicit).trim() &&
    explicit !== 'undefined' &&
    explicit !== 'null'
  ) {
    return String(explicit).trim();
  }

  if (
    req?.userId &&
    String(req.userId).trim() &&
    req.userId !== 'undefined' &&
    req.userId !== 'null'
  ) {
    return String(req.userId).trim();
  }

  if (req?.user?.id) return String(req.user.id).trim();
  if (req?.user?.sub) return String(req.user.sub).trim();

  const headerUserId = req?.headers?.['x-user-id'];
  if (
    headerUserId &&
    headerUserId !== 'undefined' &&
    headerUserId !== 'null'
  ) {
    return String(headerUserId).trim();
  }

  const queryUserId = req?.query?.userId || req?.query?.user_id;
  if (
    queryUserId &&
    queryUserId !== 'undefined' &&
    queryUserId !== 'null'
  ) {
    return String(queryUserId).trim();
  }

  const bodyUserId = req?.body?.userId || req?.body?.user_id;
  if (
    bodyUserId &&
    bodyUserId !== 'undefined' &&
    bodyUserId !== 'null'
  ) {
    return String(bodyUserId).trim();
  }

  const authHeader: string | undefined = req?.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64').toString('utf8'),
        );
        if (payload?.sub) return String(payload.sub).trim();
        if (payload?.id) return String(payload.id).trim();
      }
    } catch {}
  }

  return '';
}
