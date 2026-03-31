import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AiProvider } from './interfaces/ai-provider.interface.js';
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
    @Inject('AI_PROVIDERS') private readonly providers: AiProvider[],
    private configService: ConfigService,
  ) {
    this.cacheTtl = this.configService.get<number>('ai.cacheTtlMs') ?? 300_000;
    const providerOrder = this.providers.map((provider) => provider.getName());
    this.logger.log(
      `AI Service initialized with provider order: ${providerOrder.join(' -> ')}`,
    );
  }

  // Message analysis with cache lookup.
  async analyzeMessage(message: string): Promise<AnalysisResultDto> {
    // Try cache first.
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

      // Cache validated result.
      this.setCache(cacheKey, validated);
      return validated;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Message analysis failed: ${errMsg}`);
      return this.getFallbackAnalysis();
    }
  }

  // AI response generation.
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
      return this.getFallbackResponse(analysis, message);
    }
  }

  // Combined analyze + respond in one provider call.
  /**
   * Runs analysis and reply generation in one API call for AI-channel flows.
   */
  async analyzeAndRespond(
    message: string,
  ): Promise<{ analysis: AnalysisResultDto; response: string }> {
    try {
      const sanitized = sanitizeForPrompt(message);
      const prompt = PROMPTS.COMBINED_ANALYZE_AND_RESPOND.replace(
        '{{message}}',
        sanitized,
      );
      const result = await this.callProviderWithRetry(prompt);
      const parsed = this.parseJsonResponse<{
        analysis: AnalysisResultDto;
        response: string;
      }>(result);

      // Validate and enforce analysis rules.
      this.validateAnalysisOutput(parsed.analysis);
      const validatedAnalysis = this.enforceAnalysisRules(parsed.analysis);

      this.logger.debug(
        `Combined AI: intent=${validatedAnalysis.intent}, priority=${validatedAnalysis.priority}, ` +
          `confidence=${validatedAnalysis.confidence}`,
      );

      return {
        analysis: validatedAnalysis,
        response:
          parsed.response || this.getFallbackResponse(validatedAnalysis),
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Combined analyze+respond failed: ${errMsg}`);

      if (this.isRateLimitError(error)) {
        const quotaFallback = this.getFallbackAnalysis();
        return {
          analysis: quotaFallback,
          response: this.getFallbackResponse(quotaFallback, message),
        };
      }

      const fallbackAnalysis = this.getHeuristicAnalysis(message);
      return {
        analysis: fallbackAnalysis,
        response: this.getFallbackResponse(fallbackAnalysis, message),
      };
    }
  }

  // Agent assistance.
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

  // Quality evaluation.
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

  // Private helpers.

  /**
   * Calls providers in order until one succeeds.
   */
  private async callProviderWithRetry(prompt: string): Promise<string> {
    const failures: string[] = [];

    for (const provider of this.providers) {
      const providerName = provider.getName();

      if (!provider.isAvailable()) {
        this.logger.warn(`AI provider unavailable, skipping: ${providerName}`);
        failures.push(`${providerName}: unavailable`);
        continue;
      }

      try {
        this.logger.log(`AI provider attempt: ${providerName}`);
        const result = await provider.generateContent(prompt);
        this.logger.log(`AI provider success: ${providerName}`);
        return result;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `AI provider failed: ${providerName}. Falling back. Reason: ${errMsg}`,
        );
        failures.push(`${providerName}: ${errMsg}`);

        if (this.isRateLimitError(error)) {
          await this.sleep(800);
        }
      }
    }

    throw new Error(`All AI providers failed: ${failures.join(' | ')}`);
  }

  private isRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('429') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('QUOTA_EXCEEDED') ||
      message.includes('Too Many Requests') ||
      message.includes('rate limit') ||
      message.includes('Rate Limit')
    );
  }

  /**
   * Enforces safety rules on analysis output.
   */
  private enforceAnalysisRules(parsed: AnalysisResultDto): AnalysisResultDto {
    // Emergency intent must always be high priority.
    if (
      parsed.intent === MessageIntent.EMERGENCY &&
      parsed.priority !== MessagePriority.HIGH
    ) {
      parsed.priority = MessagePriority.HIGH;
      parsed.shouldEscalate = true;
    }

    // Low confidence should escalate.
    if (parsed.confidence < ESCALATION_CONFIDENCE_THRESHOLD) {
      parsed.shouldEscalate = true;
    }

    return parsed;
  }

  /**
   * Validates and normalizes analysis output.
   */
  private validateAnalysisOutput(parsed: AnalysisResultDto): void {
    const validIntents = Object.values(MessageIntent);
    const validPriorities = Object.values(MessagePriority);
    const validSentiments = Object.values(MessageSentiment);

    if (!validIntents.includes(parsed.intent)) {
      this.logger.warn(
        `Invalid intent from AI: "${parsed.intent}" – defaulting to general`,
      );
      parsed.intent = MessageIntent.GENERAL;
    }

    if (!validPriorities.includes(parsed.priority)) {
      this.logger.warn(
        `Invalid priority from AI: "${parsed.priority}" – defaulting to medium`,
      );
      parsed.priority = MessagePriority.MEDIUM;
    }

    if (!validSentiments.includes(parsed.sentiment)) {
      this.logger.warn(
        `Invalid sentiment from AI: "${parsed.sentiment}" – defaulting to neutral`,
      );
      parsed.sentiment = MessageSentiment.NEUTRAL;
    }

    if (
      typeof parsed.confidence !== 'number' ||
      parsed.confidence < 0 ||
      parsed.confidence > 1
    ) {
      parsed.confidence = 0.5;
    }

    if (typeof parsed.shouldEscalate !== 'boolean') {
      parsed.shouldEscalate = false;
    }
  }

  /**
   * Parses JSON and strips markdown fences when present.
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

  // Cache helpers.

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
    // Evict oldest entry when cache grows beyond limit.
    if (this.analysisCache.size > 1000) {
      const firstKey = this.analysisCache.keys().next().value as
        | string
        | undefined;
      if (firstKey) this.analysisCache.delete(firstKey);
    }

    this.analysisCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtl,
    });
  }

  // Fallbacks.

  private getFallbackAnalysis(): AnalysisResultDto {
    return {
      intent: MessageIntent.GENERAL,
      priority: MessagePriority.MEDIUM,
      sentiment: MessageSentiment.NEUTRAL,
      confidence: 0,
      shouldEscalate: false,
      reasoning: 'AI analysis temporarily unavailable',
    };
  }

  private getFallbackResponse(
    analysis: AnalysisResultDto,
    message?: string,
  ): string {
    // Detect quota/rate-limit fallback.
    const isQuota = analysis.confidence === 0;
    if (isQuota) {
      return (
        `AI is currently busy, please try again shortly.\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    const isUrgent =
      analysis.priority === MessagePriority.HIGH || analysis.shouldEscalate;
    if (isUrgent) {
      return (
        `I understand your concern. I want to make sure you get the help you need quickly. ` +
        `I strongly recommend reaching out to a healthcare professional or calling emergency services ` +
        `if this is urgent.\n\n` +
        `Would you like me to connect you with a human healthcare specialist?\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    const normalizedMessage = (message ?? '').toLowerCase();

    if (analysis.intent === MessageIntent.APPOINTMENT) {
      return (
        `I can help with appointment coordination. Please share your preferred date/time window, ` +
        `and I can route this to the scheduling team right away.\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    if (analysis.intent === MessageIntent.MEDICATION) {
      return (
        `Thanks for your medication question. For safety, I can't provide dosing advice, ` +
        `but I can help connect you with a clinician or pharmacist for accurate guidance.\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    if (analysis.intent === MessageIntent.SYMPTOM_REPORT) {
      return (
        `I'm sorry you're not feeling well. Could you share when symptoms started, whether they are worsening, ` +
        `and if you have fever, severe pain, or breathing issues so we can triage correctly?\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    if (normalizedMessage.includes('reschedule')) {
      return (
        `I can help with rescheduling. Please confirm your preferred new time and any constraints, ` +
        `and I’ll prepare this for the care team.\n\n` +
        `${AI_DISCLAIMER}`
      );
    }

    return (
      `Thank you for reaching out! I'm having a brief technical issue. ` +
      `Please try again in a moment, or I can connect you with a human specialist.\n\n` +
      `${AI_DISCLAIMER}`
    );
  }

  private getHeuristicAnalysis(message: string): AnalysisResultDto {
    const text = message.toLowerCase();

    const isEmergency =
      /chest pain|breathing|can't breathe|severe bleeding|suicid|unconscious/.test(
        text,
      );
    const isAppointment = /appointment|schedule|reschedule|cancel/.test(text);
    const isMedication = /medication|dose|dosage|side effect|pill|drug/.test(
      text,
    );
    const isSymptom = /pain|fever|headache|cough|nausea|dizzy|symptom/.test(
      text,
    );

    let intent = MessageIntent.GENERAL;
    let priority = MessagePriority.LOW;
    let sentiment = MessageSentiment.NEUTRAL;
    let shouldEscalate = false;

    if (isEmergency) {
      intent = MessageIntent.EMERGENCY;
      priority = MessagePriority.HIGH;
      sentiment = MessageSentiment.DISTRESS;
      shouldEscalate = true;
    } else if (isAppointment) {
      intent = MessageIntent.APPOINTMENT;
      priority = MessagePriority.LOW;
    } else if (isMedication) {
      intent = MessageIntent.MEDICATION;
      priority = MessagePriority.MEDIUM;
    } else if (isSymptom) {
      intent = MessageIntent.SYMPTOM_REPORT;
      priority = MessagePriority.MEDIUM;
      sentiment = MessageSentiment.DISTRESS;
    }

    return {
      intent,
      priority,
      sentiment,
      confidence: 0.65,
      shouldEscalate,
      detectedLanguage: 'en',
      reasoning: 'Heuristic fallback analysis used after provider failure',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
