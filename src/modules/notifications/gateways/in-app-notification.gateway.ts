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
 * Real-Time In-App Notification Gateway (Socket.io)
 * Pushes instant in-app toast banners and unread badge increments to active mobile users.
 */
@WebSocketGateway({ namespace: '/notifications', cors: { origin: '*' } })
export class InAppNotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(InAppNotificationGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const userId =
      (client.handshake.query?.userId as string) ||
      (client.handshake.auth?.userId as string);
    if (userId) {
      void client.join(`user:${userId}`);
      this.logger.debug(`Socket ${client.id} joined room user:${userId}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket ${client.id} disconnected from /notifications`);
  }

  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId?: string },
  ) {
    if (payload?.userId) {
      void client.join(`user:${payload.userId}`);
      return { joined: `user:${payload.userId}` };
    }
    return { joined: null };
  }

  emitNewNotification(
    userId: string,
    notification: Record<string, unknown>,
    unreadCount: number,
  ) {
    if (!this.server || !userId) return;
    this.server.to(`user:${userId}`).emit('notification:new', {
      notification,
      unreadCount,
    });
    this.server.to(`user:${userId}`).emit('notification:unread_count', {
      unreadCount,
    });
  }

  emitUnreadCount(userId: string, unreadCount: number) {
    if (!this.server || !userId) return;
    this.server.to(`user:${userId}`).emit('notification:unread_count', {
      unreadCount,
    });
  }
}
