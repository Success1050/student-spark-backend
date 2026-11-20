import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { jwtVerify } from 'jose';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service.js';

export interface FinanceLiveUpdateEvent {
  schoolId: string;
  eventType:
    | 'PAYMENT_RECORDED'
    | 'TRANSFER_APPROVED'
    | 'TRANSFER_REJECTED'
    | 'FEE_APPROVED'
    | 'FEE_CREATED'
    | 'FEE_UPDATED';
  invoiceId?: string;
  studentId?: string;
  receiptNumber?: string;
  amountKobo?: number;
  updatedAt: string;
}

/**
 * Tenant-Scoped Real-Time Finance Gateway (Socket.io)
 * Verifies the caller's JWT and enforces schoolId membership before joining school rooms,
 * preventing cross-tenant WebSocket data leakage.
 */
@WebSocketGateway({ namespace: '/finance-live', cors: { origin: '*' } })
export class FinanceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(FinanceGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly prisma: PrismaService) {}

  private getJwtSecret(): Uint8Array {
    const secret =
      process.env.JWT_SECRET ||
      process.env.JWT_ACCESS_SECRET ||
      'studentspark-default-secret-key';
    return new TextEncoder().encode(secret);
  }

  private async authenticateSocket(client: Socket): Promise<{
    userId: string;
    role: string;
    schoolId: string | null;
  } | null> {
    try {
      const rawToken =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string) ||
        (client.handshake.query?.token as string) ||
        '';
      const token = rawToken.replace(/^Bearer\s+/i, '').trim();
      if (!token) return null;

      const { payload } = await jwtVerify(token, this.getJwtSecret());
      const userId = typeof payload?.sub === 'string' ? payload.sub : '';
      if (!userId) return null;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, schoolId: true },
      });
      if (!user) return null;

      return { userId: user.id, role: user.role, schoolId: user.schoolId };
    } catch {
      return null;
    }
  }

  async handleConnection(client: Socket) {
    const auth = await this.authenticateSocket(client);
    if (!auth) {
      client.disconnect(true);
      return;
    }

    client.data.auth = auth;
    void client.join(`user:${auth.userId}`);

    const requestedSchoolId =
      (client.handshake.auth?.schoolId as string) ||
      (client.handshake.query?.schoolId as string) ||
      auth.schoolId;

    if (
      requestedSchoolId &&
      ['SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN'].includes(auth.role) &&
      (auth.role === 'SUPER_ADMIN' || auth.schoolId === requestedSchoolId)
    ) {
      void client.join(`school:${requestedSchoolId}`);
      this.logger.debug(
        `Finance socket ${client.id} joined room school:${requestedSchoolId}`,
      );
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Finance socket ${client.id} disconnected`);
  }

  @SubscribeMessage('watch_school')
  async handleWatchSchool(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { schoolId?: string },
  ) {
    const auth =
      (client.data?.auth as {
        userId: string;
        role: string;
        schoolId: string | null;
      } | null) || (await this.authenticateSocket(client));

    if (!auth) {
      client.disconnect(true);
      return { joined: null, error: 'Unauthorized' };
    }

    const targetSchoolId = payload?.schoolId || auth.schoolId;
    if (
      targetSchoolId &&
      ['SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN'].includes(auth.role) &&
      (auth.role === 'SUPER_ADMIN' || auth.schoolId === targetSchoolId)
    ) {
      void client.join(`school:${targetSchoolId}`);
      return { joined: `school:${targetSchoolId}` };
    }

    return { joined: null, error: 'Forbidden' };
  }

  emitFinanceUpdate(event: FinanceLiveUpdateEvent) {
    if (!this.server || !event?.schoolId) return;
    this.server
      .to(`school:${event.schoolId}`)
      .emit('finance:live_update', event);
    if (event.studentId) {
      this.server
        .to(`user:${event.studentId}`)
        .emit('finance:live_update', event);
    }
  }
}
