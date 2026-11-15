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
import { Server, Socket } from 'socket.io';

/**
 * Real-Time SUG Elections, Public Feed & Executive Chat Gateway (/sug-live).
 * Broadcasts live election tallies to Students, Lecturers & Admins immediately as votes arrive.
 */
@WebSocketGateway({ namespace: '/sug-live', cors: { origin: '*' } })
export class SugGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SugGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const schoolId =
      (client.handshake.query?.schoolId as string) ||
      (client.handshake.auth?.schoolId as string);
    const userId =
      (client.handshake.query?.userId as string) ||
      (client.handshake.auth?.userId as string);
    if (schoolId) void client.join(`school:${schoolId}`);
    if (userId) void client.join(`user:${userId}`);
    void client.join('nationwide:sug');
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket ${client.id} disconnected from /sug-live`);
  }

  @SubscribeMessage('watch')
  handleWatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { schoolId?: string; userId?: string },
  ) {
    if (payload?.schoolId) void client.join(`school:${payload.schoolId}`);
    if (payload?.userId) void client.join(`user:${payload.userId}`);
    void client.join('nationwide:sug');
    return { joined: true };
  }

  emitElectionUpdate(schoolId: string, payload: unknown) {
    if (!this.server || !schoolId) return;
    this.server.to(`school:${schoolId}`).emit('sug:election:update', payload);
  }

  emitPostCreated(schoolId: string, isNationwide: boolean, payload: unknown) {
    if (!this.server) return;
    if (schoolId) {
      this.server.to(`school:${schoolId}`).emit('sug:post:created', payload);
    }
    if (isNationwide) {
      this.server.to('nationwide:sug').emit('sug:post:created', payload);
    }
  }

  emitLeaderMessage(recipientId: string, senderId: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(`user:${recipientId}`).emit('sug:message:new', payload);
    this.server.to(`user:${senderId}`).emit('sug:message:new', payload);
  }
}
