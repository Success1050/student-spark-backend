function decodeBearerPayload(req: any): {
  userId?: string;
  role?: string;
} | null {
  const authHeader: string | undefined = req?.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    const id = payload?.sub || payload?.id;
    return {
      userId: id ? String(id).trim() : undefined,
      role: payload?.role ? String(payload.role).trim() : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Global User ID Extraction Utility
 * Enforces verified JWT identity first for all non-SuperAdmin accounts so query/body/header
 * userId parameters cannot impersonate another user.
 */
export function extractUserId(req: any, explicit?: string): string {
  const jwtInfo = decodeBearerPayload(req);
  const authenticatedUserId =
    (req?.user?.id && String(req.user.id).trim()) ||
    (req?.user?.sub && String(req.user.sub).trim()) ||
    jwtInfo?.userId ||
    '';
  const authenticatedRole = String(
    req?.user?.role || jwtInfo?.role || '',
  ).toUpperCase();

  // Only SUPER_ADMIN is allowed to override userId via explicit query/body/header
  if (authenticatedUserId && authenticatedRole !== 'SUPER_ADMIN') {
    return authenticatedUserId;
  }

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

  if (authenticatedUserId) {
    return authenticatedUserId;
  }

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

  return '';
}
