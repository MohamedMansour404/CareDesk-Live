import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module.js';
import {
  Conversation,
  ConversationDocument,
} from '../conversations/schemas/conversation.schema.js';
import { Message, MessageDocument } from '../messages/schemas/message.schema.js';
import {
  Evaluation,
  EvaluationDocument,
} from '../evaluation/schemas/evaluation.schema.js';

const CACHE_PREFIX = 'analytics:';
const CACHE_TTL = 60; // seconds

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectModel(Evaluation.name)
    private evaluationModel: Model<EvaluationDocument>,
    @Inject(REDIS_CLIENT) @Optional() private redis: Redis | null,
  ) {
    if (this.redis) {
      this.logger.log('Analytics using shared Redis cache');
    }
  }

  /**
   * Get overall system statistics (cached 60s).
   */
  async getOverviewStats() {
    const cacheKey = `${CACHE_PREFIX}overview`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const [
      totalConversations,
      activeConversations,
      resolvedConversations,
      totalMessages,
      priorityDistribution,
      intentDistribution,
      channelDistribution,
    ] = await Promise.all([
      this.conversationModel.countDocuments(),
      this.conversationModel.countDocuments({
        status: { $in: ['pending', 'assigned', 'in_progress'] },
      }),
      this.conversationModel.countDocuments({ status: 'resolved' }),
      this.messageModel.countDocuments(),
      this.getDistribution(this.conversationModel, 'priority'),
      this.getDistribution(this.messageModel, 'analysis.intent'),
      this.getDistribution(this.conversationModel, 'channel'),
    ]);

    const resolutionRate =
      totalConversations > 0
        ? Math.round((resolvedConversations / totalConversations) * 100)
        : 0;

    const result = {
      totalConversations,
      activeConversations,
      resolvedConversations,
      resolutionRate,
      totalMessages,
      priorityDistribution,
      intentDistribution,
      channelDistribution,
    };

    await this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Get per-agent performance statistics (cached 60s).
   */
  async getAgentStats(agentId: string) {
    const cacheKey = `${CACHE_PREFIX}agent:${agentId}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const agentOid = new Types.ObjectId(agentId);

    const [
      totalConversations,
      resolvedConversations,
      avgResponseTime,
      evaluationStats,
    ] = await Promise.all([
      this.conversationModel.countDocuments({ agent: agentOid }),
      this.conversationModel.countDocuments({
        agent: agentOid,
        status: 'resolved',
      }),
      this.calculateAvgResponseTime(agentOid),
      this.getAgentEvaluationStats(agentOid),
    ]);

    const result = {
      agentId,
      totalConversations,
      resolvedConversations,
      resolutionRate:
        totalConversations > 0
          ? Math.round((resolvedConversations / totalConversations) * 100)
          : 0,
      avgResponseTimeMs: avgResponseTime,
      avgResponseTimeFormatted: this.formatMs(avgResponseTime),
      evaluation: evaluationStats,
    };

    await this.setCache(cacheKey, result);
    return result;
  }

  // ─────────────────────────────────────────────
  // CACHE HELPERS
  // ─────────────────────────────────────────────

  private async getCache(key: string): Promise<unknown | null> {
    if (!this.redis) return null;
    try {
      const data = await this.redis.get(key);
      if (data) {
        this.logger.debug(`Analytics cache HIT: ${key}`);
        return JSON.parse(data);
      }
    } catch (err: unknown) {
      this.logger.warn(`Redis cache read failed: ${err}`);
    }
    return null;
  }

  private async setCache(key: string, value: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(key, CACHE_TTL, JSON.stringify(value));
    } catch (err: unknown) {
      this.logger.warn(`Redis cache write failed: ${err}`);
    }
  }

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  private async getDistribution(
    model: Model<unknown>,
    field: string,
  ): Promise<Record<string, number>> {
    const result = await model.aggregate([
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const distribution: Record<string, number> = {};
    for (const item of result) {
      if (item._id) {
        distribution[item._id] = item.count;
      }
    }
    return distribution;
  }

  private async calculateAvgResponseTime(
    agentOid: Types.ObjectId,
  ): Promise<number> {
    const result = await this.messageModel.aggregate([
      {
        $match: {
          sender: agentOid,
          senderRole: 'agent',
        },
      },
      {
        $lookup: {
          from: 'messages',
          let: { convId: '$conversation', agentMsgTime: '$createdAt' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$conversation', '$$convId'] },
                    { $eq: ['$senderRole', 'patient'] },
                    { $lt: ['$createdAt', '$$agentMsgTime'] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
          ],
          as: 'priorPatientMsg',
        },
      },
      { $unwind: '$priorPatientMsg' },
      {
        $project: {
          responseTimeMs: {
            $subtract: ['$createdAt', '$priorPatientMsg.createdAt'],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgResponseTimeMs: { $avg: '$responseTimeMs' },
        },
      },
    ]);

    return result.length > 0 ? Math.round(result[0].avgResponseTimeMs) : 0;
  }

  private async getAgentEvaluationStats(agentOid: Types.ObjectId) {
    const result = await this.evaluationModel.aggregate([
      { $match: { agent: agentOid } },
      {
        $group: {
          _id: null,
          averageScore: { $avg: '$score' },
          totalEvaluations: { $sum: 1 },
          minScore: { $min: '$score' },
          maxScore: { $max: '$score' },
        },
      },
    ]);

    if (result.length === 0) {
      return {
        averageScore: 0,
        totalEvaluations: 0,
        minScore: 0,
        maxScore: 0,
      };
    }

    return {
      averageScore: Math.round(result[0].averageScore * 10) / 10,
      totalEvaluations: result[0].totalEvaluations,
      minScore: result[0].minScore,
      maxScore: result[0].maxScore,
    };
  }

  private formatMs(ms: number): string {
    if (ms === 0) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  }
}
