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
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { WS_EVENTS } from '../common/constants.js';
import { ConversationsService } from '../conversations/conversations.service.js';
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
    role: string;
  };
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true, // Allow all origins; fine-grained control in afterInit
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  // ── Hardening state ────────────────────────────────
  /** Tracks which rooms each client has joined (prevents duplicate joins) */
  private readonly clientRooms = new Map<string, Set<string>>();
  /** Rate limiting: last typing timestamp per client */
  private readonly lastTypingTs = new Map<string, number>();
  private readonly TYPING_THROTTLE_MS = 2000;

  constructor(
    private jwtService: JwtService,
    private conversationsService: ConversationsService,
    private configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    // Apply proper CORS from ConfigService after module initialization
    const origins = (this.configService.get<string>('ws.corsOrigin') || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim());

    server.engine.on('initial_headers', (_headers: Record<string, string>, req: { headers: { origin?: string } }) => {
      const requestOrigin = req.headers.origin;
      if (requestOrigin && origins.includes(requestOrigin)) {
        _headers['Access-Control-Allow-Origin'] = requestOrigin;
        _headers['Access-Control-Allow-Credentials'] = 'true';
      }
    });

    this.logger.log(`WebSocket gateway initialized, CORS origins: ${origins.join(', ')}`);
  }

  // ─────────────────────────────────────────────
  // CONNECTION LIFECYCLE
  // ─────────────────────────────────────────────

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client rejected – no auth token`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      client.data = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      // Agents join the global "agents" room for queue events
      if (payload.role === 'agent') {
        await client.join('agents');
      }

      this.logger.log(
        `Client connected: ${payload.email} (${payload.role}) – ${client.id}`,
      );
    } catch {
      this.logger.warn(`Client rejected – invalid token`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    // Clean up tracking data
    this.clientRooms.delete(client.id);
    this.lastTypingTs.delete(client.id);

    if (client.data?.email) {
      const connectedCount = this.server.sockets.sockets.size;
      this.logger.log(
        `Client disconnected: ${client.data.email} — ${connectedCount} active connections`,
      );
    }
  }

  // ── VALIDATION HELPERS ─────────────────────────────

  private isValidObjectId(id: unknown): boolean {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
  }

  // ─────────────────────────────────────────────
  // CLIENT → SERVER EVENTS (with security)
  // ─────────────────────────────────────────────

  @SubscribeMessage('join:conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    // ── VALIDATION ──
    if (!data?.conversationId || !this.isValidObjectId(data.conversationId)) {
      client.emit('error', { message: 'Invalid conversationId' });
      return;
    }

    // ── DUPLICATE JOIN PREVENTION ──
    const rooms = this.clientRooms.get(client.id) ?? new Set();
    const roomName = `conversation:${data.conversationId}`;
    if (rooms.has(roomName)) {
      return; // Already in this room — no-op
    }

    // ── SECURITY: Verify user is a participant ──
    const isParticipant = await this.conversationsService.isParticipant(
      data.conversationId,
      client.data.userId,
    );

    if (!isParticipant && client.data.role !== 'agent') {
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
    this.logger.debug(
      `${client.data.email} joined room ${roomName}`,
    );
  }

  @SubscribeMessage('leave:conversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId) return;
    const roomName = `conversation:${data.conversationId}`;
    await client.leave(roomName);

    // Clean up tracking
    const rooms = this.clientRooms.get(client.id);
    if (rooms) rooms.delete(roomName);
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId || !this.isValidObjectId(data.conversationId)) return;

    // ── RATE LIMITING: max 1 typing event per TYPING_THROTTLE_MS ──
    const now = Date.now();
    const lastTs = this.lastTypingTs.get(client.id) ?? 0;
    if (now - lastTs < this.TYPING_THROTTLE_MS) return;
    this.lastTypingTs.set(client.id, now);

    const event =
      client.data.role === 'agent'
        ? WS_EVENTS.AGENT_TYPING
        : WS_EVENTS.PATIENT_TYPING;

    client.to(`conversation:${data.conversationId}`).emit(event, {
      userId: client.data.userId,
      conversationId: data.conversationId,
    });
  }

  // ─────────────────────────────────────────────
  // EVENT LISTENERS (replaces direct service calls)
  // ─────────────────────────────────────────────

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
      .emit('message:ai:complete', {
        conversationId: event.conversationId,
        patientMessageId: event.patientMessageId,
        analysis: event.analysis,
        aiResponse: event.aiResponse,
        channel: event.channel,
        correlationId: event.correlationId,
      });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_CREATED)
  handleConversationCreatedWs(event: ConversationCreatedEvent) {
    if (event.channel === 'human') {
      this.server
        .to('agents')
        .emit(WS_EVENTS.CONVERSATION_NEW, {
          conversation: event.conversationData,
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

    this.server
      .to('agents')
      .emit(WS_EVENTS.CONVERSATION_ASSIGNED, {
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

    this.server
      .to('agents')
      .emit(WS_EVENTS.CONVERSATION_RESOLVED, {
        conversationId: event.conversationId,
      });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_TRANSFERRED)
  handleConversationTransferredWs(event: ConversationTransferredEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit('conversation:transferred', {
        conversationId: event.conversationId,
        fromAgentId: event.fromAgentId,
        toAgentId: event.toAgentId,
      });

    this.server.to('agents').emit('conversation:transferred', {
      conversationId: event.conversationId,
      toAgentId: event.toAgentId,
    });
  }

  @OnEvent(SYSTEM_EVENTS.EVALUATION_CREATED)
  handleEvaluationCreatedWs(event: EvaluationCreatedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit('evaluation:new', {
        conversationId: event.conversationId,
        evaluation: event.evaluationData,
      });
  }

  @OnEvent(SYSTEM_EVENTS.CONVERSATION_ESCALATED)
  handleConversationEscalatedWs(event: ConversationEscalatedEvent) {
    // Notify the patient's conversation room
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.CONVERSATION_ESCALATED, {
        conversationId: event.conversationId,
        conversation: event.conversationData,
      });

    // Notify all agents so the conversation appears in their queue
    this.server
      .to('agents')
      .emit(WS_EVENTS.CONVERSATION_ESCALATED, {
        conversationId: event.conversationId,
        conversation: event.conversationData,
      });
  }
}
