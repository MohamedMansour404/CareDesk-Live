import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Evaluation,
  EvaluationDocument,
} from './schemas/evaluation.schema.js';
import { AiService } from '../ai/ai.service.js';

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @InjectModel(Evaluation.name)
    private evaluationModel: Model<EvaluationDocument>,
    private aiService: AiService,
  ) {}

  /**
   * Evaluate an agent's response using AI quality analysis.
   */
  async evaluateAgentResponse(
    conversationId: string,
    agentId: string,
    patientMessageId: string,
    agentMessageId: string,
    patientContent: string,
    agentContent: string,
  ): Promise<EvaluationDocument> {
    const qualityResult = await this.aiService.evaluateResponse(
      patientContent,
      agentContent,
    );

    const evaluation = new this.evaluationModel({
      conversation: new Types.ObjectId(conversationId),
      agent: new Types.ObjectId(agentId),
      patientMessage: new Types.ObjectId(patientMessageId),
      agentMessage: new Types.ObjectId(agentMessageId),
      score: qualityResult.score,
      feedback: qualityResult.feedback,
      issues: qualityResult.issues,
      suggestions: qualityResult.suggestions,
    });

    const saved = await evaluation.save();
    this.logger.log(
      `Evaluation created for agent ${agentId}: score=${qualityResult.score}/10`,
    );
    return saved;
  }

  /**
   * Get all evaluations for a specific agent.
   */
  async findByAgent(agentId: string): Promise<EvaluationDocument[]> {
    return this.evaluationModel
      .find({ agent: new Types.ObjectId(agentId) })
      .sort({ createdAt: -1 })
      .populate('conversation')
      .exec();
  }

  /**
   * Get evaluations for a specific conversation.
   */
  async findByConversation(
    conversationId: string,
  ): Promise<EvaluationDocument[]> {
    return this.evaluationModel
      .find({ conversation: new Types.ObjectId(conversationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get average score for an agent.
   */
  async getAgentAverageScore(
    agentId: string,
  ): Promise<{ averageScore: number; totalEvaluations: number }> {
    const result = await this.evaluationModel.aggregate([
      { $match: { agent: new Types.ObjectId(agentId) } },
      {
        $group: {
          _id: null,
          averageScore: { $avg: '$score' },
          totalEvaluations: { $sum: 1 },
        },
      },
    ]);

    if (result.length === 0) {
      return { averageScore: 0, totalEvaluations: 0 };
    }

    return {
      averageScore: Math.round(result[0].averageScore * 10) / 10,
      totalEvaluations: result[0].totalEvaluations,
    };
  }
}
