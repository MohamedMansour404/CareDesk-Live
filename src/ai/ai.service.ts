import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AiProvider, AI_PROVIDER } from './interfaces/ai-provider.interface.js';
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
import { sanitizeForPrompt } from '../common/utils/sanitize.js';

interface CacheEntry {
  data: AnalysisResultDto;
  expiresAt: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly analysisCache = new Map<string, CacheEntry>();
  private readonly cacheTtl: number;

  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private configService: ConfigService,
  ) {
    this.cacheTtl = this.configService.get<number>('ai.cacheTtlMs') ?? 300_000;
    this.logger.log(
      `AI Service initialized with provider: ${provider.getName()}`,
    );
  }

  // ─────────────────────────────────────────────
  // 1. MESSAGE ANALYSIS (with caching)
  // ─────────────────────────────────────────────
  async analyzeMessage(message: string): Promise<AnalysisResultDto> {
    // Check cache first
    const cacheKey = this.hashMessage(message);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.debug('Analysis cache HIT');
      return cached;
    }

    try {
      const sanitized = sanitizeForPrompt(message);
      const prompt = PROMPTS.MESSAGE_ANALYSIS.replace('{{message}}', sanitized);
      const result = await this.callProviderWithRetry(prompt);
      const parsed = this.parseJsonResponse<AnalysisResultDto>(result);
      this.validateAnalysisOutput(parsed);
      const validated = this.enforceAnalysisRules(parsed);

      this.logger.debug(
        `Analysis: intent=${validated.intent}, priority=${validated.priority}, ` +
          `sentiment=${validated.sentiment}, confidence=${validated.confidence}, ` +
          `escalate=${validated.shouldEscalate}`,
      );

      // Cache the result
      this.setCache(cacheKey, validated);
      return validated;
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

      return await this.callProviderWithRetry(prompt);
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
      const result = await this.callProviderWithRetry(prompt);
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

      const result = await this.callProviderWithRetry(prompt);
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
   * Calls the AI provider with retry logic (exponential backoff, 3 attempts).
   */
  private async callProviderWithRetry(
    prompt: string,
    maxRetries = 3,
  ): Promise<string> {
    if (!this.provider.isAvailable()) {
      throw new Error(`AI provider ${this.provider.getName()} is not available`);
    }

    let lastError: Error = new Error('All retry attempts failed');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.provider.generateContent(prompt);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `${this.provider.getName()} attempt ${attempt}/${maxRetries} failed: ${lastError.message}`,
        );

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Enforces safety rules on AI analysis output (code-enforced, not prompt-dependent).
   */
  private enforceAnalysisRules(parsed: AnalysisResultDto): AnalysisResultDto {
    // Rule 1: Emergency intent MUST be high priority
    if (
      parsed.intent === MessageIntent.EMERGENCY &&
      parsed.priority !== MessagePriority.HIGH
    ) {
      parsed.priority = MessagePriority.HIGH;
      parsed.shouldEscalate = true;
    }

    // Rule 2: Low confidence triggers escalation
    if (parsed.confidence < ESCALATION_CONFIDENCE_THRESHOLD) {
      parsed.shouldEscalate = true;
    }

    return parsed;
  }

  /**
   * Validates that the AI's analysis output has valid structure and values.
   */
  private validateAnalysisOutput(parsed: AnalysisResultDto): void {
    const validIntents = Object.values(MessageIntent);
    const validPriorities = Object.values(MessagePriority);
    const validSentiments = Object.values(MessageSentiment);

    if (!validIntents.includes(parsed.intent)) {
      this.logger.warn(`Invalid intent from AI: "${parsed.intent}" – using fallback`);
      throw new Error(`Invalid AI analysis: unknown intent "${parsed.intent}"`);
    }

    if (!validPriorities.includes(parsed.priority)) {
      this.logger.warn(`Invalid priority from AI: "${parsed.priority}" – using fallback`);
      throw new Error(`Invalid AI analysis: unknown priority "${parsed.priority}"`);
    }

    if (!validSentiments.includes(parsed.sentiment)) {
      this.logger.warn(`Invalid sentiment from AI: "${parsed.sentiment}" – using fallback`);
      throw new Error(`Invalid AI analysis: unknown sentiment "${parsed.sentiment}"`);
    }

    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0.5;
    }

    if (typeof parsed.shouldEscalate !== 'boolean') {
      parsed.shouldEscalate = true;
    }
  }

  /**
   * Parses JSON from LLM response, stripping markdown code fences if present.
   */
  private parseJsonResponse<T>(text: string): T {
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

  // ── Cache helpers ──────────────────────────

  private hashMessage(message: string): string {
    return createHash('sha256')
      .update(message.toLowerCase().trim())
      .digest('hex');
  }

  private getFromCache(key: string): AnalysisResultDto | null {
    const entry = this.analysisCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.analysisCache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache(key: string, data: AnalysisResultDto): void {
    // Evict old entries if cache grows beyond 1000
    if (this.analysisCache.size > 1000) {
      const firstKey = this.analysisCache.keys().next().value;
      if (firstKey) this.analysisCache.delete(firstKey);
    }

    this.analysisCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtl,
    });
  }

  // ── Fallbacks ──────────────────────────────

  private getFallbackAnalysis(): AnalysisResultDto {
    return {
      intent: MessageIntent.GENERAL,
      priority: MessagePriority.HIGH,
      sentiment: MessageSentiment.NEUTRAL,
      confidence: 0,
      shouldEscalate: true,
      reasoning: 'AI analysis unavailable – defaulting to high priority for safety',
    };
  }

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
