import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiProvider } from '../interfaces/ai-provider.interface.js';

/**
 * Google Gemini AI provider with controlled retry behavior.
 *
 * Strategy:
 * - 429 / quota errors: fail fast (no retry)
 * - Other transient errors: max 1 retry with a short fixed delay
 */
@Injectable()
export class GeminiProvider extends AiProvider implements OnModuleInit {
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenerativeAI | null = null;
  private primaryModelName: string;
  private available = false;
  private readonly maxAttempts = 2;
  private readonly retryDelayMs = 2500;

  constructor(private configService: ConfigService) {
    super();
    this.primaryModelName =
      this.configService.get<string>('gemini.model') ?? 'gemini-2.0-flash';
  }

  onModuleInit() {
    const apiKey = this.configService.get<string>('gemini.apiKey');

    if (!apiKey) {
      this.logger.warn('Gemini API key not configured – provider unavailable');
      return;
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.available = true;
    this.logger.log(
      `Gemini provider initialized (primary: ${this.primaryModelName})`,
    );
  }

  async generateContent(prompt: string): Promise<string> {
    if (!this.genAI) {
      throw new Error('Gemini not initialized – missing API key');
    }

    const model = this.genAI.getGenerativeModel({
      model: this.primaryModelName,
    });

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        this.logger.debug(
          `Gemini request attempt ${attempt}/${this.maxAttempts} (${this.primaryModelName})`,
        );
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from Gemini');
        }

        if (attempt > 1) {
          this.logger.log(
            `Gemini succeeded on retry attempt ${attempt} (${this.primaryModelName})`,
          );
        }

        return text.trim();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (this.isQuotaError(message)) {
          const quotaError = new Error(
            `QUOTA_EXCEEDED: Gemini rate limit reached on ${this.primaryModelName}`,
          );
          (quotaError as Error & { isQuota: boolean }).isQuota = true;
          throw quotaError;
        }

        if (attempt >= this.maxAttempts) {
          throw error;
        }

        this.logger.warn(
          `Gemini transient error on attempt ${attempt}/${this.maxAttempts}: ${message}. Retrying in ${this.retryDelayMs}ms`,
        );
        await this.sleep(this.retryDelayMs);
      }
    }

    throw new Error('Gemini request failed without explicit error');
  }

  /** Returns true for 429 / quota-exceeded / rate-limit errors */
  private isQuotaError(message: string): boolean {
    return (
      message.includes('429') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('quota') ||
      message.includes('Quota') ||
      message.includes('Too Many Requests') ||
      message.includes('rate limit') ||
      message.includes('Rate Limit')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getName(): string {
    return `Gemini (${this.primaryModelName})`;
  }

  isAvailable(): boolean {
    return this.available;
  }
}
