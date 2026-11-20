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
 * Real-time Socket.io Gateway for Day 18 Inter-School Tournaments & Academic Olympiads (/tournaments).
 * Broadcasts live standings updates, spectator play-by-play commentary, anti-cheat strikes, cheers, and status transitions.
 */
@WebSocketGateway({ namespace: '/tournaments', cors: { origin: '*' } })
export class TournamentsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TournamentsGateway.name);
  private readonly viewersByTournament = new Map<string, Set<string>>();
  private readonly tournamentsBySocket = new Map<string, Set<string>>();

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const userId =
      (client.handshake.auth?.userId as string) ||
      (client.handshake.query?.userId as string);
    if (userId) {
      void client.join(`user:${userId}`);
    }
  }

  handleDisconnect(client: Socket) {
    const joined = this.tournamentsBySocket.get(client.id);
    if (joined) {
      for (const tournamentId of joined) {
        const set = this.viewersByTournament.get(tournamentId);
        if (set) {
          set.delete(client.id);
          if (set.size === 0) {
            this.viewersByTournament.delete(tournamentId);
          }
        }
        this.emitViewerCount(tournamentId);
      }
      this.tournamentsBySocket.delete(client.id);
    }
    this.logger.debug(`Socket ${client.id} disconnected from /tournaments`);
  }

  getViewerCount(tournamentId: string): number {
    return this.viewersByTournament.get(tournamentId)?.size || 0;
  }

  private emitViewerCount(tournamentId: string) {
    this.server?.to(`tournament:${tournamentId}`).emit('tournament:viewers', {
      tournamentId,
      viewerCount: this.getViewerCount(tournamentId),
    });
  }

  @SubscribeMessage('join:tournament')
  handleJoinTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tournamentId?: string },
  ) {
    const tid = payload?.tournamentId;
    if (!tid) return { joined: false };

    void client.join(`tournament:${tid}`);
    if (!this.viewersByTournament.has(tid)) {
      this.viewersByTournament.set(tid, new Set());
    }
    this.viewersByTournament.get(tid)!.add(client.id);

    if (!this.tournamentsBySocket.has(client.id)) {
      this.tournamentsBySocket.set(client.id, new Set());
    }
    this.tournamentsBySocket.get(client.id)!.add(tid);

    this.emitViewerCount(tid);
    return { joined: true, tournamentId: tid, viewerCount: this.getViewerCount(tid) };
  }

  @SubscribeMessage('leave:tournament')
  handleLeaveTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { tournamentId?: string },
  ) {
    const tid = payload?.tournamentId;
    if (!tid) return { left: false };

    void client.leave(`tournament:${tid}`);
    this.viewersByTournament.get(tid)?.delete(client.id);
    this.tournamentsBySocket.get(client.id)?.delete(tid);
    this.emitViewerCount(tid);
    return { left: true };
  }

  @SubscribeMessage('spectator:cheer')
  handleLiveCheer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      tournamentId?: string;
      senderName?: string;
      emoji?: string;
    },
  ) {
    if (!payload?.tournamentId || !payload?.emoji) return { ok: false };
    this.server?.to(`tournament:${payload.tournamentId}`).emit('tournament:cheer_burst', {
      tournamentId: payload.tournamentId,
      senderName: payload.senderName || 'Spectator',
      emoji: payload.emoji,
      timestamp: Date.now(),
    });
    return { ok: true };
  }

  emitStandingsUpdate(tournamentId: string, payload: unknown) {
    this.server?.to(`tournament:${tournamentId}`).emit('tournament:standings', {
      tournamentId,
      ...((payload as Record<string, unknown>) || {}),
    });
  }

  emitFeedEvent(tournamentId: string, event: unknown) {
    this.server?.to(`tournament:${tournamentId}`).emit('tournament:feed', {
      tournamentId,
      event,
    });
  }

  emitStatusChange(tournamentId: string, status: string) {
    this.server?.to(`tournament:${tournamentId}`).emit('tournament:status', {
      tournamentId,
      status,
    });
  }
}
