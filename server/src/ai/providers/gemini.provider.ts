import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { AiProvider } from '../interfaces/ai-provider.interface.js';

/**
 * Google Gemini AI provider with robust rate-limit handling.
 *
 * Free-tier Gemini API has aggressive per-minute rate limits (typically 15 RPM).
 * The API returns 429 with a `retryDelay` field (usually 18-46s).
 *
 * Strategy:
 * 1. Try the primary model first (configured in GEMINI_MODEL)
 * 2. On 429, wait for the API-specified retryDelay (or 20s default)
 * 3. If primary model fails all retries, try fallback models
 */
@Injectable()
export class GeminiProvider extends AiProvider implements OnModuleInit {
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenerativeAI | null = null;
  private primaryModelName: string;
  private available = false;

  // Fallback models to try if primary model quota is exhausted
  private readonly fallbackModels = [
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ];

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
      `Gemini provider initialized (primary: ${this.primaryModelName}, ` +
        `fallbacks: ${this.fallbackModels.join(', ')})`,
    );
  }

  async generateContent(prompt: string): Promise<string> {
    if (!this.genAI) {
      throw new Error('Gemini not initialized – missing API key');
    }

    // Try primary model with retries
    const result = await this.tryModelWithRetries(
      this.primaryModelName,
      prompt,
      3,
    );
    if (result !== null) return result;

    // Primary model exhausted — try fallback models (1 attempt each)
    for (const fallbackModel of this.fallbackModels) {
      this.logger.warn(
        `Primary model ${this.primaryModelName} exhausted, trying fallback: ${fallbackModel}`,
      );
      const fallbackResult = await this.tryModelWithRetries(
        fallbackModel,
        prompt,
        1,
      );
      if (fallbackResult !== null) return fallbackResult;
    }

    // All models exhausted
    const quotaError = new Error(
      `QUOTA_EXCEEDED: All models exhausted (primary: ${this.primaryModelName}, fallbacks: ${this.fallbackModels.join(', ')})`,
    );
    (quotaError as Error & { isQuota: boolean }).isQuota = true;
    throw quotaError;
  }

  /**
   * Try a specific model with retries.
   * Returns the response text on success, or null if all retries are exhausted.
   */
  private async tryModelWithRetries(
    modelName: string,
    prompt: string,
    maxAttempts: number,
  ): Promise<string | null> {
    const model = this.genAI!.getGenerativeModel({ model: modelName });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from Gemini');
        }

        if (attempt > 1 || modelName !== this.primaryModelName) {
          this.logger.log(
            `✅ Success with ${modelName} on attempt ${attempt}`,
          );
        }

        return text.trim();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (this.isQuotaError(message)) {
          if (attempt < maxAttempts) {
            // Extract retryDelay from error if available, otherwise use 20s default
            const delay = this.extractRetryDelay(message);
            this.logger.warn(
              `Rate limited (429) on ${modelName} – attempt ${attempt}/${maxAttempts}, ` +
                `waiting ${delay}ms...`,
            );
            await this.sleep(delay);
            continue;
          }
          this.logger.warn(
            `${modelName} quota exhausted after ${maxAttempts} attempts`,
          );
          return null; // Signal to try fallback
        }

        // Non-quota error — rethrow immediately
        throw error;
      }
    }

    return null;
  }

  /**
   * Extract retryDelay from Gemini 429 error message.
   * The error often contains "retryDelay":"18s" or similar.
   * Returns delay in milliseconds. Default: 20000ms (20s).
   */
  private extractRetryDelay(errorMessage: string): number {
    const match = errorMessage.match(/retryDelay["\s:]*(\d+)s/i);
    if (match) {
      const seconds = parseInt(match[1], 10);
      // Add 2s buffer to be safe
      return (seconds + 2) * 1000;
    }
    // Default to 20 seconds — matches typical free-tier retryDelay
    return 20000;
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
