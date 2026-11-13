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
import { GamesService } from '../games.service.js';
import { BattleQuestion } from '../dto/games.dto.js';

interface ActiveBattleRoom {
  matchId: string;
  roomPin: string;
  hostSocketId: string;
  hostUserId: string;
  hostName: string;
  hostAvatar?: string;
  hostScore: number;
  opponentSocketId?: string;
  opponentUserId?: string;
  opponentName?: string;
  opponentAvatar?: string;
  opponentScore: number;
  isAiOpponent?: boolean;
  questions: BattleQuestion[];
  currentQuestionIndex: number;
  roundTimer?: NodeJS.Timeout;
  aiAnswerTimer?: NodeJS.Timeout;
  hostAnswer?: { selectedOption: number; timeRemaining: number; isCorrect: boolean };
  opponentAnswer?: { selectedOption: number; timeRemaining: number; isCorrect: boolean };
}

interface QueuedPlayer {
  socket: Socket;
  userId: string;
  userName: string;
  avatarUrl?: string;
  queuedAt: number;
  timer?: NodeJS.Timeout;
}

@WebSocketGateway({ namespace: '/games/quiz-battle', cors: { origin: '*' } })
export class QuizBattleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Active rooms keyed by roomPin
  private readonly activeRooms = new Map<string, ActiveBattleRoom>();
  // Quick match queue
  private matchmakingQueue: QueuedPlayer[] = [];

  constructor(private readonly gamesService: GamesService) {}

  handleConnection(client: Socket) {
    // Client connected
  }

  handleDisconnect(client: Socket) {
    // Remove from quick match queue
    this.matchmakingQueue = this.matchmakingQueue.filter((q) => {
      if (q.socket.id === client.id) {
        if (q.timer) clearTimeout(q.timer);
        return false;
      }
      return true;
    });

    // Check if client was part of an active room
    for (const [pin, room] of this.activeRooms.entries()) {
      if (room.hostSocketId === client.id || room.opponentSocketId === client.id) {
        if (room.roundTimer) clearTimeout(room.roundTimer);
        if (room.aiAnswerTimer) clearTimeout(room.aiAnswerTimer);

        const isHost = room.hostSocketId === client.id;
        const otherSocketId = isHost ? room.opponentSocketId : room.hostSocketId;

        if (otherSocketId && otherSocketId !== 'AI_OPPONENT') {
          this.server.to(otherSocketId).emit('battle:opponent_disconnected', {
            message: 'Opponent disconnected from the arena. Match ended.',
            forfeitWinnerId: isHost ? room.opponentUserId : room.hostUserId,
          });
        }
        this.activeRooms.delete(pin);
        break;
      }
    }
  }

  /**
   * Host initializes a 1v1 duel room
   */
  @SubscribeMessage('battle:host')
  async handleHostBattle(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      userId: string;
      userName: string;
      avatarUrl?: string;
      noteId?: string;
      roomPin?: string;
    },
  ) {
    const resolvedUser = await this.gamesService.resolveUserProfile(
      payload.userId,
      payload.userName,
      payload.avatarUrl,
    );
    const questions = await this.gamesService.generateBattleQuestions(payload.noteId);

    let pin = payload.roomPin || 'SPK-' + Math.floor(1000 + Math.random() * 9000);
    pin = pin.trim().toUpperCase();

    const room: ActiveBattleRoom = {
      matchId: 'match-' + Date.now(),
      roomPin: pin,
      hostSocketId: client.id,
      hostUserId: payload.userId,
      hostName: resolvedUser.fullName || 'Host Scholar',
      hostAvatar: resolvedUser.avatarUrl,
      hostScore: 0,
      opponentScore: 0,
      questions,
      currentQuestionIndex: 0,
    };

    this.activeRooms.set(pin, room);
    client.join(`battle:${pin}`);

    client.emit('battle:hosted', {
      success: true,
      roomPin: pin,
      totalQuestions: questions.length,
      questionDurationSeconds: 15,
      host: {
        userId: room.hostUserId,
        userName: room.hostName,
        avatarUrl: room.hostAvatar,
      },
    });
  }

  /**
   * Challenger joins an existing room by PIN
   */
  @SubscribeMessage('battle:join')
  async handleJoinBattle(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      roomPin: string;
      userId: string;
      userName: string;
      avatarUrl?: string;
    },
  ) {
    const pin = (payload.roomPin || '').trim().toUpperCase();
    const room = this.activeRooms.get(pin);

    if (!room) {
      client.emit('battle:error', {
        message: `No active battle arena found with PIN ${pin}. Please check PIN or host a new match.`,
      });
      return;
    }

    if (room.opponentSocketId && room.opponentSocketId !== client.id) {
      client.emit('battle:error', {
        message: 'This battle arena is already full with 2 players.',
      });
      return;
    }

    const resolvedUser = await this.gamesService.resolveUserProfile(
      payload.userId,
      payload.userName,
      payload.avatarUrl,
    );

    room.opponentSocketId = client.id;
    room.opponentUserId = payload.userId;
    room.opponentName = resolvedUser.fullName || 'Challenger';
    room.opponentAvatar = resolvedUser.avatarUrl;

    client.join(`battle:${pin}`);

    // Notify both players that duel is ready
    this.server.to(`battle:${pin}`).emit('battle:ready', {
      roomPin: pin,
      host: {
        userId: room.hostUserId,
        userName: room.hostName,
        avatarUrl: room.hostAvatar,
        score: room.hostScore,
      },
      opponent: {
        userId: room.opponentUserId,
        userName: room.opponentName,
        avatarUrl: room.opponentAvatar,
        score: room.opponentScore,
      },
      totalQuestions: room.questions.length,
      durationPerQuestion: 15,
    });

    // Start 3-second countdown then question 1
    this.startBattleCountdown(pin);
  }

  /**
   * Quick Match / Matchmaking queue
   */
  @SubscribeMessage('battle:quick_match')
  async handleQuickMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      userId: string;
      userName: string;
      avatarUrl?: string;
    },
  ) {
    const resolvedUser = await this.gamesService.resolveUserProfile(
      payload.userId,
      payload.userName,
      payload.avatarUrl,
    );

    // Check if there is an existing human player in queue
    const opponentInQueue = this.matchmakingQueue.find(
      (q) => q.socket.id !== client.id && q.userId !== payload.userId,
    );

    if (opponentInQueue) {
      // Remove opponent from queue
      if (opponentInQueue.timer) clearTimeout(opponentInQueue.timer);
      this.matchmakingQueue = this.matchmakingQueue.filter(
        (q) => q.socket.id !== opponentInQueue.socket.id,
      );

      const pin = 'SPK-' + Math.floor(1000 + Math.random() * 9000);
      const questions = await this.gamesService.generateBattleQuestions();

      const room: ActiveBattleRoom = {
        matchId: 'quick-' + Date.now(),
        roomPin: pin,
        hostSocketId: opponentInQueue.socket.id,
        hostUserId: opponentInQueue.userId,
        hostName: opponentInQueue.userName,
        hostAvatar: opponentInQueue.avatarUrl,
        hostScore: 0,
        opponentSocketId: client.id,
        opponentUserId: payload.userId,
        opponentName: resolvedUser.fullName || 'Challenger',
        opponentAvatar: resolvedUser.avatarUrl,
        opponentScore: 0,
        questions,
        currentQuestionIndex: 0,
      };

      this.activeRooms.set(pin, room);
      opponentInQueue.socket.join(`battle:${pin}`);
      client.join(`battle:${pin}`);

      this.server.to(`battle:${pin}`).emit('battle:ready', {
        roomPin: pin,
        isQuickMatch: true,
        host: {
          userId: room.hostUserId,
          userName: room.hostName,
          avatarUrl: room.hostAvatar,
          score: 0,
        },
        opponent: {
          userId: room.opponentUserId,
          userName: room.opponentName,
          avatarUrl: room.opponentAvatar,
          score: 0,
        },
        totalQuestions: questions.length,
        durationPerQuestion: 15,
      });

      this.startBattleCountdown(pin);
    } else {
      // Add to queue with a 4-second timeout to match with simulated AI bot
      const queueItem: QueuedPlayer = {
        socket: client,
        userId: payload.userId,
        userName: resolvedUser.fullName || 'Scholar',
        avatarUrl: resolvedUser.avatarUrl,
        queuedAt: Date.now(),
      };

      queueItem.timer = setTimeout(async () => {
        // Remove from queue
        this.matchmakingQueue = this.matchmakingQueue.filter(
          (q) => q.socket.id !== client.id,
        );

        // Spawn simulated AI Scholar opponent
        const pin = 'SPK-' + Math.floor(1000 + Math.random() * 9000);
        const questions = await this.gamesService.generateBattleQuestions();

        const room: ActiveBattleRoom = {
          matchId: 'ai-duel-' + Date.now(),
          roomPin: pin,
          hostSocketId: client.id,
          hostUserId: payload.userId,
          hostName: resolvedUser.fullName || 'Scholar',
          hostAvatar: resolvedUser.avatarUrl,
          hostScore: 0,
          opponentSocketId: 'AI_OPPONENT',
          opponentUserId: 'ai-scholar-bot',
          opponentName: '🤖 Spark AI Scholar',
          opponentAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
          opponentScore: 0,
          isAiOpponent: true,
          questions,
          currentQuestionIndex: 0,
        };

        this.activeRooms.set(pin, room);
        client.join(`battle:${pin}`);

        client.emit('battle:ready', {
          roomPin: pin,
          isQuickMatch: true,
          isAiMatch: true,
          host: {
            userId: room.hostUserId,
            userName: room.hostName,
            avatarUrl: room.hostAvatar,
            score: 0,
          },
          opponent: {
            userId: room.opponentUserId,
            userName: room.opponentName,
            avatarUrl: room.opponentAvatar,
            score: 0,
          },
          totalQuestions: questions.length,
          durationPerQuestion: 15,
        });

        this.startBattleCountdown(pin);
      }, 4000);

      this.matchmakingQueue.push(queueItem);
      client.emit('battle:searching', {
        message: 'Searching for an academic rival...',
      });
    }
  }

  /**
   * Player submits an answer for current question
   */
  @SubscribeMessage('battle:submit_answer')
  handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      roomPin: string;
      questionIndex: number;
      selectedOption: number;
      timeRemaining: number;
    },
  ) {
    const pin = (payload.roomPin || '').trim().toUpperCase();
    const room = this.activeRooms.get(pin);
    if (!room) return;

    const currentQ = room.questions[room.currentQuestionIndex];
    if (!currentQ) return;

    const isHost = client.id === room.hostSocketId;
    const isOpponent = client.id === room.opponentSocketId;
    if (!isHost && !isOpponent) return;

    const isCorrect = payload.selectedOption === currentQ.correctIndex;
    const speedBonus = isCorrect ? Math.round(Math.max(0, payload.timeRemaining) * 6) : 0;
    const roundScore = isCorrect ? 100 + speedBonus : 0;

    if (isHost && !room.hostAnswer) {
      room.hostAnswer = {
        selectedOption: payload.selectedOption,
        timeRemaining: payload.timeRemaining,
        isCorrect,
      };
      room.hostScore += roundScore;

      // Broadcast to opponent that host has locked in their answer
      if (room.opponentSocketId && room.opponentSocketId !== 'AI_OPPONENT') {
        this.server.to(room.opponentSocketId).emit('battle:opponent_answered', {
          player: 'HOST',
        });
      }
    } else if (isOpponent && !room.opponentAnswer) {
      room.opponentAnswer = {
        selectedOption: payload.selectedOption,
        timeRemaining: payload.timeRemaining,
        isCorrect,
      };
      room.opponentScore += roundScore;

      // Broadcast to host that opponent has locked in
      this.server.to(room.hostSocketId).emit('battle:opponent_answered', {
        player: 'OPPONENT',
      });
    }

    // If both have answered, resolve round immediately
    if (room.hostAnswer && room.opponentAnswer) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      if (room.aiAnswerTimer) clearTimeout(room.aiAnswerTimer);
      this.resolveRound(pin);
    }
  }

  /**
   * Emoji reaction burst
   */
  @SubscribeMessage('battle:reaction')
  handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomPin: string; emoji: string },
  ) {
    const pin = (payload.roomPin || '').trim().toUpperCase();
    const room = this.activeRooms.get(pin);
    if (!room) return;

    const isHost = client.id === room.hostSocketId;
    this.server.to(`battle:${pin}`).emit('battle:reaction_received', {
      fromHost: isHost,
      emoji: payload.emoji,
    });
  }

  // =========================================================================
  // INTERNAL ROUND CONTROLLERS
  // =========================================================================

  private startBattleCountdown(pin: string) {
    let count = 3;
    const interval = setInterval(() => {
      this.server.to(`battle:${pin}`).emit('battle:countdown', { count });
      count--;
      if (count < 0) {
        clearInterval(interval);
        this.serveCurrentQuestion(pin);
      }
    }, 1000);
  }

  private serveCurrentQuestion(pin: string) {
    const room = this.activeRooms.get(pin);
    if (!room) return;

    const q = room.questions[room.currentQuestionIndex];
    if (!q) {
      this.finishBattle(pin);
      return;
    }

    room.hostAnswer = undefined;
    room.opponentAnswer = undefined;

    // Send question without revealing correctIndex
    this.server.to(`battle:${pin}`).emit('battle:question', {
      questionIndex: room.currentQuestionIndex,
      totalQuestions: room.questions.length,
      durationSeconds: 15,
      question: {
        id: q.id,
        question: q.question,
        options: q.options,
        category: q.category,
      },
      hostScore: room.hostScore,
      opponentScore: room.opponentScore,
    });

    // Simulate AI opponent answering if applicable
    if (room.isAiOpponent) {
      const aiDelay = Math.floor(Math.random() * 6000) + 4000; // 4s - 10s
      room.aiAnswerTimer = setTimeout(() => {
        const isAiCorrect = Math.random() < 0.8; // 80% accuracy
        const chosenOption = isAiCorrect
          ? q.correctIndex
          : (q.correctIndex + 1) % 4;

        const timeRem = Math.max(1, Math.round(15 - aiDelay / 1000));
        const aiScore = isAiCorrect ? 100 + timeRem * 6 : 0;

        room.opponentAnswer = {
          selectedOption: chosenOption,
          timeRemaining: timeRem,
          isCorrect: isAiCorrect,
        };
        room.opponentScore += aiScore;

        this.server.to(room.hostSocketId).emit('battle:opponent_answered', {
          player: 'OPPONENT',
        });

        if (room.hostAnswer) {
          if (room.roundTimer) clearTimeout(room.roundTimer);
          this.resolveRound(pin);
        }
      }, aiDelay);
    }

    // 15-second round expiration timer
    room.roundTimer = setTimeout(() => {
      this.resolveRound(pin);
    }, 16000);
  }

  private resolveRound(pin: string) {
    const room = this.activeRooms.get(pin);
    if (!room) return;

    const currentQ = room.questions[room.currentQuestionIndex];
    if (!currentQ) return;

    this.server.to(`battle:${pin}`).emit('battle:round_result', {
      questionIndex: room.currentQuestionIndex,
      correctIndex: currentQ.correctIndex,
      explanation: currentQ.explanation,
      hostAnswer: room.hostAnswer || { selectedOption: -1, isCorrect: false },
      opponentAnswer: room.opponentAnswer || { selectedOption: -1, isCorrect: false },
      hostScore: room.hostScore,
      opponentScore: room.opponentScore,
    });

    // Transition to next question or end after 3 seconds
    setTimeout(() => {
      room.currentQuestionIndex++;
      if (room.currentQuestionIndex < room.questions.length) {
        this.serveCurrentQuestion(pin);
      } else {
        this.finishBattle(pin);
      }
    }, 3200);
  }

  private async finishBattle(pin: string) {
    const room = this.activeRooms.get(pin);
    if (!room) return;

    const isTie = room.hostScore === room.opponentScore;
    const winnerId = isTie
      ? null
      : room.hostScore > room.opponentScore
      ? room.hostUserId
      : room.opponentUserId;

    // Record battle in database and calculate XP
    let summary: any = null;
    try {
      summary = await this.gamesService.completeBattleMatch(
        room.matchId,
        room.hostScore,
        room.opponentScore,
        winnerId || undefined,
      );
    } catch {
      summary = {
        hostXpAwarded: isTie ? 40 : winnerId === room.hostUserId ? 60 : 25,
        opponentXpAwarded: isTie ? 40 : winnerId === room.opponentUserId ? 60 : 25,
      };
    }

    this.server.to(`battle:${pin}`).emit('battle:completed', {
      winnerId,
      isTie,
      hostScore: room.hostScore,
      opponentScore: room.opponentScore,
      host: {
        userId: room.hostUserId,
        userName: room.hostName,
        avatarUrl: room.hostAvatar,
        score: room.hostScore,
        xpAwarded: summary?.hostXpAwarded || (winnerId === room.hostUserId ? 60 : 25),
      },
      opponent: {
        userId: room.opponentUserId,
        userName: room.opponentName,
        avatarUrl: room.opponentAvatar,
        score: room.opponentScore,
        xpAwarded: summary?.opponentXpAwarded || (winnerId === room.opponentUserId ? 60 : 25),
      },
      summary: isTie
        ? 'A brilliant academic stalemate! Both scholars proved their mettle.'
        : winnerId === room.hostUserId
        ? `${room.hostName} emerged victorious in this fierce scholarly duel!`
        : `${room.opponentName} claimed the victor’s laurels!`,
    });

    this.activeRooms.delete(pin);
  }
}
