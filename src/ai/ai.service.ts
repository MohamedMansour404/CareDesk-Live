import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { PROMPTS } from './prompts/index.js';
import {
  AnalysisResultDto,
  AiAssistanceResultDto,
  QualityEvaluationDto,
} from './dto/ai-result.dto.js';
import {
  MessagePriority,
  MessageIntent,
  MessageSentiment,
  AI_DISCLAIMER,
  ESCALATION_CONFIDENCE_THRESHOLD,
} from '../common/constants.js';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private model: GenerativeModel | null = null;
  private genAI: GoogleGenerativeAI | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const modelName = this.configService.get<string>('gemini.model') ?? 'gemini-2.0-flash';

    if (!apiKey) {
      this.logger.warn(
        'Gemini API key not configured – AI features will use fallback responses',
      );
      return;
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    this.logger.log(`AI Service initialized with model: ${modelName}`);
  }

  // ─────────────────────────────────────────────
  // 1. MESSAGE ANALYSIS
  // ─────────────────────────────────────────────
  async analyzeMessage(message: string): Promise<AnalysisResultDto> {
    try {
      const prompt = PROMPTS.MESSAGE_ANALYSIS.replace('{{message}}', message);
      const result = await this.callGeminiWithRetry(prompt);
      const parsed = this.parseJsonResponse<AnalysisResultDto>(result);

      // Enforce: emergency intent MUST be high priority
      if (
        parsed.intent === MessageIntent.EMERGENCY &&
        parsed.priority !== MessagePriority.HIGH
      ) {
        parsed.priority = MessagePriority.HIGH;
        parsed.shouldEscalate = true;
      }

      // Enforce: low confidence triggers escalation
      if (parsed.confidence < ESCALATION_CONFIDENCE_THRESHOLD) {
        parsed.shouldEscalate = true;
      }

      this.logger.debug(
        `Analysis: intent=${parsed.intent}, priority=${parsed.priority}, ` +
          `sentiment=${parsed.sentiment}, confidence=${parsed.confidence}, ` +
          `escalate=${parsed.shouldEscalate}`,
      );

      return parsed;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Message analysis failed: ${errMsg}`);
      return this.getFallbackAnalysis();
    }
  }

  // ─────────────────────────────────────────────
  // 2. AI RESPONSE GENERATION
  // ─────────────────────────────────────────────
  async generateResponse(
    message: string,
    analysis: AnalysisResultDto,
  ): Promise<string> {
    try {
      const prompt = PROMPTS.AI_RESPONSE.replace('{{message}}', message)
        .replace('{{intent}}', analysis.intent)
        .replace('{{priority}}', analysis.priority)
        .replace('{{sentiment}}', analysis.sentiment)
        .replace('{{shouldEscalate}}', String(analysis.shouldEscalate));

      const response = await this.callGeminiWithRetry(prompt);
      return response;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI response generation failed: ${errMsg}`);
      return this.getFallbackResponse(analysis);
    }
  }

  // ─────────────────────────────────────────────
  // 3. AGENT ASSISTANCE
  // ─────────────────────────────────────────────
  async generateAgentAssistance(
    conversationHistory: string,
  ): Promise<AiAssistanceResultDto> {
    try {
      const prompt = PROMPTS.AGENT_ASSISTANCE.replace(
        '{{conversationHistory}}',
        conversationHistory,
      );
      const result = await this.callGeminiWithRetry(prompt);
      return this.parseJsonResponse<AiAssistanceResultDto>(result);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent assistance failed: ${errMsg}`);
      return {
        summary: 'Unable to generate summary at this time.',
        keyPoints: [],
        suggestedReply: 'Unable to generate suggestion at this time.',
        relevantContext: '',
      };
    }
  }

  // ─────────────────────────────────────────────
  // 4. QUALITY EVALUATION
  // ─────────────────────────────────────────────
  async evaluateResponse(
    patientMessage: string,
    agentResponse: string,
  ): Promise<QualityEvaluationDto> {
    try {
      const prompt = PROMPTS.QUALITY_EVALUATION.replace(
        '{{patientMessage}}',
        patientMessage,
      ).replace('{{agentResponse}}', agentResponse);

      const result = await this.callGeminiWithRetry(prompt);
      return this.parseJsonResponse<QualityEvaluationDto>(result);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Quality evaluation failed: ${errMsg}`);
      return {
        score: 0,
        feedback: 'Evaluation could not be completed at this time.',
        issues: ['AI evaluation service unavailable'],
        suggestions: [],
      };
    }
  }

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  /**
   * Calls Gemini API with retry logic (exponential backoff, 3 attempts).
   */
  private async callGeminiWithRetry(
    prompt: string,
    maxRetries = 3,
  ): Promise<string> {
    if (!this.model) {
      throw new Error('AI model not initialized – missing API key');
    }

    let lastError: Error = new Error('All retry attempts failed');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from Gemini');
        }

        return text.trim();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Gemini API attempt ${attempt}/${maxRetries} failed: ${lastError.message}`,
        );

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Parses JSON from LLM response, stripping markdown code fences if present.
   */
  private parseJsonResponse<T>(text: string): T {
    // Strip markdown code fences (```json ... ```)
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      this.logger.error(`Failed to parse AI JSON response: ${cleaned}`);
      throw new Error('Invalid JSON response from AI');
    }
  }

  /**
   * Returns a safe fallback analysis when the AI service is unavailable.
   * Defaults to high priority to err on the side of caution.
   */
  private getFallbackAnalysis(): AnalysisResultDto {
    return {
      intent: MessageIntent.GENERAL,
      priority: MessagePriority.HIGH,
      sentiment: MessageSentiment.NEUTRAL,
      confidence: 0,
      shouldEscalate: true,
      reasoning:
        'AI analysis unavailable – defaulting to high priority for safety',
    };
  }

  /**
   * Returns a safe fallback response when AI generation fails.
   */
  private getFallbackResponse(analysis: AnalysisResultDto): string {
    const isUrgent =
      analysis.priority === MessagePriority.HIGH || analysis.shouldEscalate;

    if (isUrgent) {
      return (
        `I understand your concern. While I'm currently unable to provide a detailed response, ` +
        `I want to make sure you get the help you need as quickly as possible. ` +
        `I strongly recommend reaching out to a healthcare professional or calling emergency services ` +
        `if you feel this is urgent.\n\n` +
        `Would you like me to connect you with a human healthcare specialist?\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    return (
      `Thank you for reaching out! I'm currently experiencing some technical difficulties ` +
      `and cannot provide a full response right now. Please try again in a moment, ` +
      `or I can connect you with a human specialist if you prefer.\n\n` +
      `${AI_DISCLAIMER}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
