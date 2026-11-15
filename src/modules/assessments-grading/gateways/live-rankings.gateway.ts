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

export interface LiveRankingMover {
  studentId: string;
  fullName: string;
  className: string;
  newRank: number;
  previousRank: number | null;
  rankDelta: number;
  averageScore: number;
  gpa: number;
}

export interface LiveRankingUpdateEvent {
  schoolId: string;
  termId: string;
  termName?: string;
  sessionName?: string;
  eventType: 'GRADES_SAVED' | 'CBT_IMPORTED' | 'RESULTS_PUBLISHED' | 'CONFIG_UPDATED';
  subjectId?: string;
  subjectName?: string;
  classId?: string;
  className?: string;
  combinedKey?: string;
  combinedLabel?: string;
  updatedCount?: number;
  summaryText: string;
  movers: LiveRankingMover[];
  updatedAt: string;
}

/**
 * Real-Time SofaScore-Style Live Rankings Gateway (Socket.io)
 * Broadcasts instant grade updates & rank movements to active Admin, Teacher & Student viewers.
 */
@WebSocketGateway({ namespace: '/live-rankings', cors: { origin: '*' } })
export class LiveRankingsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(LiveRankingsGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const schoolId =
      (client.handshake.query?.schoolId as string) ||
      (client.handshake.auth?.schoolId as string);
    if (schoolId) {
      void client.join(`school:${schoolId}`);
      this.logger.debug(`Socket ${client.id} watching school:${schoolId}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket ${client.id} disconnected from /live-rankings`);
  }

  @SubscribeMessage('watch')
  handleWatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { schoolId?: string },
  ) {
    if (payload?.schoolId) {
      void client.join(`school:${payload.schoolId}`);
      return { joined: `school:${payload.schoolId}` };
    }
    return { joined: null };
  }

  emitLiveUpdate(event: LiveRankingUpdateEvent) {
    if (!this.server || !event?.schoolId) return;
    this.server.to(`school:${event.schoolId}`).emit('ranking:live_update', event);
  }
}
