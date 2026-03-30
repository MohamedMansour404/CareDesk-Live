import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module.js';
import { UserRole, WS_EVENTS } from '../common/constants.js';
import { ConversationAccessPolicy } from '../conversations/access/conversation-access.policy.js';
import { ConversationAccessAction } from '../conversations/access/conversation-access.types.js';
import { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import {
  SYSTEM_EVENTS,
  MessageCreatedEvent,
  AgentRepliedEvent,
  AiProcessingCompleteEvent,
  ConversationCreatedEvent,
  ConversationAssignedEvent,
  ConversationResolvedEvent,
  ConversationTransferredEvent,
  ConversationEscalatedEvent,
  EvaluationCreatedEvent,
} from '../common/events/index.js';
import { Types } from 'mongoose';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    email: string;
    role: UserRole;
  };
}

type AdapterWithClose = {
  close?: (...args: unknown[]) => void | Promise<void>;
};

interface ConversationRealtimeSummary {
  _id?: string;
  channel?: string;
  status?: string;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
  patient?: unknown;
  agent?: unknown;
  intakeSummary?: {
    hasIntake: boolean;
    triageLevel?: string;
    triageScore?: number;
    complaintSnippet?: string;
  };
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  private readonly clientRooms = new Map<string, Set<string>>();
  private readonly lastTypingTs = new Map<string, number>();
  private readonly TYPING_THROTTLE_MS = 2000;

  private redisSubClient: Redis | null = null;
  private shutdownStarted = false;
  private socketServerClosed = false;
  private allowedOrigins = new Set<string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly conversationAccessPolicy: ConversationAccessPolicy,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async onModuleDestroy() {
    await this.shutdownGracefully('module-destroy');
  }

  async shutdownGracefully(reason: string): Promise<void> {
    if (this.shutdownStarted) {
      return;
    }

    this.shutdownStarted = true;

    await this.closeSocketServer(reason);
    await this.closeAdapterSubClient(reason);
  }

  private async closeSocketServer(reason: string): Promise<void> {
    if (!this.server || this.socketServerClosed) {
      return;
    }

    this.socketServerClosed = true;

    await new Promise<void>((resolve) => {
      void this.server.close((error?: Error) => {
        if (error && !this.isConnectionClosedError(error)) {
          this.logger.warn(
            `Socket.IO server close reported error (${reason}): ${error.message}`,
          );
        }

        this.logger.log(`Socket.IO server closed (${reason})`);
        resolve();
      });
    });
  }

  private async closeAdapterSubClient(reason: string): Promise<void> {
    const subClient = this.redisSubClient;
    this.redisSubClient = null;

    if (!subClient) {
      return;
    }

    if (subClient.status === 'end') {
      this.logger.log(`Socket.IO Redis sub-client already closed (${reason})`);
      return;
    }

    try {
      await subClient.quit();
      this.logger.log(`Socket.IO Redis sub-client closed (${reason})`);
    } catch (error: unknown) {
      if (this.isConnectionClosedError(error)) {
        this.logger.log(
          `Socket.IO Redis sub-client already closed while shutting down (${reason})`,
        );
        return;
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Socket.IO Redis sub-client quit failed (${reason}): ${errMsg}`,
      );
      subClient.disconnect(false);
    }
  }

  private isConnectionClosedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('connection is closed');
  }

  private buildConversationSummary(
    conversationData: unknown,
  ): ConversationRealtimeSummary {
    const conversation = (conversationData ?? {}) as Record<string, unknown>;
    const intake = conversation.intake as Record<string, unknown> | undefined;
    const triage = intake?.triage as Record<string, unknown> | undefined;
    const clinical = intake?.clinical as Record<string, unknown> | undefined;
    const complaint =
      typeof clinical?.mainComplaint === 'string'
        ? clinical.mainComplaint
        : undefined;

    return {
      _id: typeof conversation._id === 'string' ? conversation._id : undefined,
      channel:
        typeof conversation.channel === 'string'
          ? conversation.channel
          : undefined,
      status:
        typeof conversation.status === 'string'
          ? conversation.status
          : undefined,
      priority:
        typeof conversation.priority === 'string'
          ? conversation.priority
          : undefined,
      createdAt:
        typeof conversation.createdAt === 'string'
          ? conversation.createdAt
          : undefined,
      updatedAt:
        typeof conversation.updatedAt === 'string'
          ? conversation.updatedAt
          : undefined,
      patient: conversation.patient,
      agent: conversation.agent,
      intakeSummary: {
        hasIntake: Boolean(intake),
        triageLevel:
          typeof triage?.level === 'string' ? triage.level : undefined,
        triageScore:
          typeof triage?.score === 'number' ? triage.score : undefined,
        complaintSnippet: complaint ? complaint.slice(0, 120) : undefined,
      },
    };
  }

  afterInit(server: Server) {
    const origins = (
      this.configService.get<string>('ws.corsOrigin') || 'http://localhost:5173'
    )
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    this.allowedOrigins = new Set(origins);

    server.engine.opts.allowRequest = (
      req: { headers?: { origin?: string } },
      callback: (error: string | null, success: boolean) => void,
    ) => {
      const requestOrigin = req.headers?.origin;
      if (requestOrigin && this.allowedOrigins.has(requestOrigin)) {
        callback(null, true);
        return;
      }

      this.logger.warn(
        `WebSocket handshake rejected for origin: ${requestOrigin ?? 'unknown'}`,
      );
      callback('origin not allowed', false);
    };

    server.engine.on(
      'initial_headers',
      (
        headers: Record<string, string>,
        req: { headers: { origin?: string } },
      ) => {
        const requestOrigin = req.headers.origin;
        if (requestOrigin && this.allowedOrigins.has(requestOrigin)) {
          headers['Access-Control-Allow-Origin'] = requestOrigin;
          headers['Access-Control-Allow-Credentials'] = 'true';
        }
      },
    );

    this.logger.log(
      `WebSocket gateway initialized, CORS origins: ${origins.join(', ')}`,
    );

    this.enableRedisAdapter(server);
  }

  private enableRedisAdapter(server: Server) {
    const redisPub = this.redis;
    if (!redisPub) {
      this.logger.warn(
        'Socket.IO Redis adapter disabled: shared Redis client unavailable',
      );
      return;
    }

    this.redisSubClient = this.redis.duplicate();
    this.redisSubClient
      .connect()
      .then(() => {
        const adapterFactory = createAdapter as unknown as (
          pubClient: Redis,
          subClient: Redis,
        ) => Parameters<Server['adapter']>[0];

        server.adapter(adapterFactory(redisPub, this.redisSubClient as Redis));
        this.patchRootAdapterClose(server);
        this.logger.log(
          'Socket.IO Redis adapter enabled for multi-instance sync',
        );
      })
      .catch((error: unknown) => {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to initialize Socket.IO Redis adapter: ${errMsg}`,
        );
      });
  }

  private patchRootAdapterClose(server: Server): void {
    const rootAdapter = server.of('/').adapter as AdapterWithClose;
    if (!rootAdapter || typeof rootAdapter.close !== 'function') {
      return;
    }

    const originalClose: (...args: unknown[]) => void | Promise<void> =
      rootAdapter.close;
    let adapterClosed = false;

    rootAdapter.close = (...closeArgs: unknown[]) => {
      if (adapterClosed) {
        return;
      }

      adapterClosed = true;

      try {
        const result = originalClose(...closeArgs);
        if (result instanceof Promise) {
          void result.catch((error: unknown) => {
            if (this.isConnectionClosedError(error)) {
              return;
            }
            throw error;
          });
        }
      } catch (error: unknown) {
        if (this.isConnectionClosedError(error)) {
          return;
        }
        throw error;
      }
    };
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const origin = client.handshake.headers.origin;
      if (!origin || !this.allowedOrigins.has(origin)) {
        this.logger.warn(
          `Client rejected – origin denied (${origin ?? 'none'})`,
        );
        client.disconnect();
        return;
      }

      const auth = client.handshake.auth as Record<string, unknown> | undefined;
      const authToken = auth?.token;
      const headerAuth = client.handshake.headers?.authorization;
      const tokenFromAuth =
        typeof authToken === 'string' ? authToken : undefined;
      const tokenFromHeader =
        typeof headerAuth === 'string'
          ? headerAuth.replace('Bearer ', '')
          : undefined;
      const token = tokenFromAuth ?? tokenFromHeader;

      if (!token) {
        this.logger.warn('Client rejected – no auth token');
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<JwtPayload>(token);
      if (payload.tokenType && payload.tokenType !== 'access') {
        this.logger.warn('Client rejected – invalid token type');
        client.disconnect();
        return;
      }

      const role = payload.role as UserRole;
      client.data = {
        userId: payload.sub,
        email: payload.email,
        role,
      };

      if (role === UserRole.AGENT) {
        await client.join('agents');
      }

      this.logger.log(
        `Client connected: ${payload.email} (${role}) – ${client.id}`,
      );
    } catch {
      this.logger.warn('Client rejected – invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.clientRooms.delete(client.id);
    this.lastTypingTs.delete(client.id);

    if (client.data?.email) {
      const connectedCount = this.server.sockets.sockets.size;
      this.logger.log(
        `Client disconnected: ${client.data.email} — ${connectedCount} active connections`,
      );
    }
  }

  private isValidObjectId(id: unknown): boolean {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
  }

  isReady(): boolean {
    return (
      Boolean(this.server) && !this.shutdownStarted && !this.socketServerClosed
    );
  }

  @SubscribeMessage('join:conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId || !this.isValidObjectId(data.conversationId)) {
      client.emit('error', { message: 'Invalid conversationId' });
      return;
    }

    const rooms = this.clientRooms.get(client.id) ?? new Set();
    const roomName = `conversation:${data.conversationId}`;
    if (rooms.has(roomName)) {
      return;
    }

    const isAuthorized = await this.conversationAccessPolicy
      .assertCanAccess(
        {
          userId: client.data.userId,
          role: client.data.role,
        },
        data.conversationId,
        ConversationAccessAction.JOIN_REALTIME,
        { allowQueueViewForAgents: false },
      )
      .then(() => true)
      .catch(() => false);

    if (!isAuthorized) {
      this.logger.warn(
        `REJECTED: ${client.data.email} tried to join conversation ${data.conversationId} without access`,
      );
      client.emit('error', {
        message: 'Not authorized to join this conversation',
      });
      return;
    }

    await client.join(roomName);
    rooms.add(roomName);
    this.clientRooms.set(client.id, rooms);
    this.logger.debug(`${client.data.email} joined room ${roomName}`);
  }

  @SubscribeMessage('leave:conversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId) return;
    const roomName = `conversation:${data.conversationId}`;
    await client.leave(roomName);

    const rooms = this.clientRooms.get(client.id);
    if (rooms) rooms.delete(roomName);
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId || !this.isValidObjectId(data.conversationId)) {
      return;
    }

    const now = Date.now();
    const lastTs = this.lastTypingTs.get(client.id) ?? 0;
    if (now - lastTs < this.TYPING_THROTTLE_MS) return;
    this.lastTypingTs.set(client.id, now);

    const event =
      client.data.role === UserRole.AGENT
        ? WS_EVENTS.AGENT_TYPING
        : WS_EVENTS.PATIENT_TYPING;

    client.to(`conversation:${data.conversationId}`).emit(event, {
      userId: client.data.userId,
      role: client.data.role,
      conversationId: data.conversationId,
    });
  }

  @OnEvent(SYSTEM_EVENTS.MESSAGE_CREATED)
  handleMessageCreatedWs(event: MessageCreatedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.MESSAGE_NEW, {
        message: event.messageData,
        conversationId: event.conversationId,
        correlationId: event.correlationId,
      });
  }

  @OnEvent(SYSTEM_EVENTS.MESSAGE_AGENT_REPLIED)
  handleAgentRepliedWs(event: AgentRepliedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.MESSAGE_NEW, {
        message: event.messageData,
        conversationId: event.conversationId,
        correlationId: event.correlationId,
      });
  }

  @OnEvent(SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE)
  handleAiProcessingCompleteWs(event: AiProcessingCompleteEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.MESSAGE_AI_COMPLETE, {
        conversationId: event.conversationId,
        patientMessageId: event.patientMessageId,
        analysis: event.analysis,
        aiResponse: event.aiResponse,
        channel: event.channel,
        correlationId: event.correlationId,
      });
  }

  @OnEvent(SYSTEM_EVENTS.MESSAGE_QUEUE_FAILED)
  handleMessageQueueFailedWs(event: {
    conversationId: string;
    messageId: string;
    reason: string;
    correlationId?: string;
  }): void {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.MESSAGE_QUEUE_FAILED, {
        conversationId: event.conversationId,
        messageId: event.messageId,
        reason: event.reason,
        correlationId: event.correlationId,
      });

    this.server.to('agents').emit(WS_EVENTS.MESSAGE_QUEUE_FAILED, {
      conversationId: event.conversationId,
      messageId: event.messageId,
      reason: event.reason,
      correlationId: event.correlationId,
    });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_CREATED)
  handleConversationCreatedWs(event: ConversationCreatedEvent) {
    if (event.channel === 'human') {
      this.server.to('agents').emit(WS_EVENTS.CONVERSATION_NEW, {
        conversation: this.buildConversationSummary(event.conversationData),
      });
    }
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_ASSIGNED)
  handleConversationAssignedWs(event: ConversationAssignedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.CONVERSATION_ASSIGNED, {
        conversationId: event.conversationId,
        agentId: event.agentId,
      });

    this.server.to('agents').emit(WS_EVENTS.CONVERSATION_ASSIGNED, {
      conversationId: event.conversationId,
      agentId: event.agentId,
    });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_RESOLVED)
  handleConversationResolvedWs(event: ConversationResolvedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.CONVERSATION_RESOLVED, {
        conversationId: event.conversationId,
      });

    this.server.to('agents').emit(WS_EVENTS.CONVERSATION_RESOLVED, {
      conversationId: event.conversationId,
    });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_TRANSFERRED)
  handleConversationTransferredWs(event: ConversationTransferredEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.CONVERSATION_TRANSFERRED, {
        conversationId: event.conversationId,
        fromAgentId: event.fromAgentId,
        toAgentId: event.toAgentId,
      });

    this.server.to('agents').emit(WS_EVENTS.CONVERSATION_TRANSFERRED, {
      conversationId: event.conversationId,
      toAgentId: event.toAgentId,
    });
  }

  @OnEvent(SYSTEM_EVENTS.EVALUATION_CREATED)
  handleEvaluationCreatedWs(event: EvaluationCreatedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.EVALUATION_NEW, {
        conversationId: event.conversationId,
        evaluation: event.evaluationData,
      });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_ESCALATED)
  handleConversationEscalatedWs(event: ConversationEscalatedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.CONVERSATION_ESCALATED, {
        conversationId: event.conversationId,
        conversation: this.buildConversationSummary(event.conversationData),
      });

    this.server.to('agents').emit(WS_EVENTS.CONVERSATION_ESCALATED, {
      conversationId: event.conversationId,
      conversation: this.buildConversationSummary(event.conversationData),
    });
  }
}
