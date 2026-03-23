import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
  EvaluationCreatedEvent,
} from '../common/events/index.js';

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
    origin: (process.env.WS_CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private jwtService: JwtService,
    private conversationsService: ConversationsService,
    private configService: ConfigService,
  ) {}

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
    if (client.data?.email) {
      this.logger.log(`Client disconnected: ${client.data.email}`);
    }
  }

  // ─────────────────────────────────────────────
  // CLIENT → SERVER EVENTS (with security)
  // ─────────────────────────────────────────────

  @SubscribeMessage('join:conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
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

    await client.join(`conversation:${data.conversationId}`);
    this.logger.debug(
      `${client.data.email} joined room conversation:${data.conversationId}`,
    );
  }

  @SubscribeMessage('leave:conversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    await client.leave(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
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
      });
  }

  @OnEvent(SYSTEM_EVENTS.MESSAGE_AGENT_REPLIED)
  handleAgentRepliedWs(event: AgentRepliedEvent) {
    this.server
      .to(`conversation:${event.conversationId}`)
      .emit(WS_EVENTS.MESSAGE_NEW, {
        message: event.messageData,
        conversationId: event.conversationId,
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
}
