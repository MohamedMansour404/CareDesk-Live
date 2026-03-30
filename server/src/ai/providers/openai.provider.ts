import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiProvider } from '../interfaces/ai-provider.interface.js';

/**
 * OpenAI provider — uses GPT-4o-mini for fast, reliable AI responses.
 * Much more reliable than Gemini free tier (no aggressive rate limits).
 */
@Injectable()
export class OpenAiProvider extends AiProvider implements OnModuleInit {
  private readonly logger = new Logger(OpenAiProvider.name);
  private client: OpenAI | null = null;
  private modelName: string;
  private available = false;

  constructor(private configService: ConfigService) {
    super();
    this.modelName =
      this.configService.get<string>('openai.model') ?? 'gpt-4o-mini';
  }

  onModuleInit() {
    const apiKey = this.configService.get<string>('openai.apiKey');

    if (!apiKey) {
      this.logger.warn('OpenAI API key not configured – provider unavailable');
      return;
    }

    this.client = new OpenAI({ apiKey });
    this.available = true;
    this.logger.log(`OpenAI provider initialized (model: ${this.modelName})`);
  }

  async generateContent(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized – missing API key');
    }

    // Retry with exponential backoff for rate-limit errors
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.modelName,
          messages: [
            {
              role: 'system',
              content:
                'You are CareDesk AI, a healthcare support assistant. Always respond with valid JSON when the prompt asks for JSON.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        });

        const text = response.choices[0]?.message?.content;

        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from OpenAI');
        }

        return text.trim();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (this.isRateLimitError(message, error)) {
          if (attempt < maxAttempts) {
            const delay = attempt * 2000; // 2s, 4s
            this.logger.warn(
              `Rate limited – attempt ${attempt}/${maxAttempts}, retrying in ${delay}ms...`,
            );
            await this.sleep(delay);
            continue;
          }
          const quotaError = new Error(`QUOTA_EXCEEDED: ${message}`);
          (quotaError as Error & { isQuota: boolean }).isQuota = true;
          throw quotaError;
        }

        // Non-rate-limit error — rethrow
        throw error;
      }
    }

    throw new Error('All retry attempts exhausted');
  }

  private isRateLimitError(message: string, error: unknown): boolean {
    if (
      message.includes('429') ||
      message.includes('rate_limit') ||
      message.includes('Rate limit')
    ) {
      return true;
    }
    // Check OpenAI error status
    if (error && typeof error === 'object' && 'status' in error) {
      return (error as { status: number }).status === 429;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getName(): string {
    return `OpenAI (${this.modelName})`;
  }

  isAvailable(): boolean {
    return this.available;
  }
}
