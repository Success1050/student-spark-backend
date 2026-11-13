import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Real-time Socket.io Gateway for Discord-style Student Study Communities & Channels
 */
@WebSocketGateway({ namespace: '/communities', cors: { origin: '*' } })
export class CommunitiesGateway {
  @WebSocketServer()
  server: Server;
}
