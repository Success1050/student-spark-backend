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
 * Real-time Socket.io Gateway for Day 17 Dual-Zone Communities & 1v1 Direct Messages (/communities).
 * Handles live channel messaging, typing indicators, emoji reactions, pins, DM delivery & online presence.
 */
@WebSocketGateway({ namespace: '/communities', cors: { origin: '*' } })
export class CommunitiesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CommunitiesGateway.name);
  private readonly onlineSocketsByUser = new Map<string, Set<string>>();
  private readonly userBySocketId = new Map<string, string>();

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const userId =
      (client.handshake.auth?.userId as string) ||
      (client.handshake.query?.userId as string);
    const schoolId =
      (client.handshake.auth?.schoolId as string) ||
      (client.handshake.query?.schoolId as string);

    if (userId) {
      void client.join(`user:${userId}`);
      this.userBySocketId.set(client.id, userId);
      if (!this.onlineSocketsByUser.has(userId)) {
        this.onlineSocketsByUser.set(userId, new Set());
      }
      this.onlineSocketsByUser.get(userId)!.add(client.id);
    }
    if (schoolId) {
      void client.join(`school:${schoolId}`);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.userBySocketId.get(client.id);
    if (userId) {
      this.userBySocketId.delete(client.id);
      const set = this.onlineSocketsByUser.get(userId);
      if (set) {
        set.delete(client.id);
        if (set.size === 0) {
          this.onlineSocketsByUser.delete(userId);
        }
      }
    }
    this.logger.debug(`Socket ${client.id} disconnected from /communities`);
  }

  isUserOnline(userId: string): boolean {
    const set = this.onlineSocketsByUser.get(userId);
    return !!set && set.size > 0;
  }

  getOnlineUserCount(): number {
    return this.onlineSocketsByUser.size;
  }

  @SubscribeMessage('join:channel')
  handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId?: string },
  ) {
    if (payload?.channelId) {
      void client.join(`channel:${payload.channelId}`);
      return { joined: true, channelId: payload.channelId };
    }
    return { joined: false };
  }

  @SubscribeMessage('leave:channel')
  handleLeaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId?: string },
  ) {
    if (payload?.channelId) {
      void client.leave(`channel:${payload.channelId}`);
    }
    return { left: true };
  }

  @SubscribeMessage('join:dm')
  handleJoinDm(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string },
  ) {
    if (payload?.conversationId) {
      void client.join(`dm:${payload.conversationId}`);
      return { joined: true, conversationId: payload.conversationId };
    }
    return { joined: false };
  }

  @SubscribeMessage('leave:dm')
  handleLeaveDm(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string },
  ) {
    if (payload?.conversationId) {
      void client.leave(`dm:${payload.conversationId}`);
    }
    return { left: true };
  }

  @SubscribeMessage('typing:channel')
  handleChannelTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { channelId?: string; userId?: string; fullName?: string; isTyping?: boolean },
  ) {
    if (!payload?.channelId) return;
    client.to(`channel:${payload.channelId}`).emit('community:typing', {
      channelId: payload.channelId,
      userId: payload.userId,
      fullName: payload.fullName || 'Someone',
      isTyping: !!payload.isTyping,
    });
  }

  @SubscribeMessage('typing:dm')
  handleDmTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { conversationId?: string; userId?: string; fullName?: string; isTyping?: boolean },
  ) {
    if (!payload?.conversationId) return;
    client.to(`dm:${payload.conversationId}`).emit('dm:typing', {
      conversationId: payload.conversationId,
      userId: payload.userId,
      fullName: payload.fullName || 'Someone',
      isTyping: !!payload.isTyping,
    });
  }

  emitChannelMessage(channelId: string, message: unknown) {
    if (!this.server || !channelId) return;
    this.server.to(`channel:${channelId}`).emit('community:message:new', {
      channelId,
      message,
    });
  }

  emitChannelMessageUpdated(channelId: string, message: unknown) {
    if (!this.server || !channelId) return;
    this.server.to(`channel:${channelId}`).emit('community:message:updated', {
      channelId,
      message,
    });
  }

  emitChannelMessageDeleted(channelId: string, messageId: string) {
    if (!this.server || !channelId) return;
    this.server.to(`channel:${channelId}`).emit('community:message:deleted', {
      channelId,
      messageId,
    });
  }

  emitDmMessage(
    conversationId: string,
    participantAId: string,
    participantBId: string,
    message: unknown,
  ) {
    if (!this.server) return;
    const eventPayload = { conversationId, message };
    this.server.to(`dm:${conversationId}`).emit('dm:message:new', eventPayload);
    this.server.to(`user:${participantAId}`).emit('dm:message:new', eventPayload);
    this.server.to(`user:${participantBId}`).emit('dm:message:new', eventPayload);
  }

  emitDmRead(conversationId: string, readerId: string) {
    if (!this.server || !conversationId) return;
    this.server.to(`dm:${conversationId}`).emit('dm:read', {
      conversationId,
      readerId,
      readAt: new Date().toISOString(),
    });
  }
}
