import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider } from '../interfaces/ai-provider.interface.js';

interface OpenRouterChoice {
  message?: {
    content?: string;
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
  };
}

@Injectable()
export class OpenRouterProvider extends AiProvider implements OnModuleInit {
  private readonly logger = new Logger(OpenRouterProvider.name);
  private readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  private apiKey: string | null = null;
  private modelName: string;
  private available = false;
  private readonly maxAttempts = 3;

  constructor(private readonly configService: ConfigService) {
    super();
    this.modelName =
      this.configService.get<string>('openrouter.model') ??
      'mistralai/mistral-7b-instruct-v0.1';
  }

  onModuleInit(): void {
    const apiKey = this.configService.get<string>('openrouter.apiKey');

    if (!apiKey) {
      this.logger.warn(
        'OpenRouter API key not configured – provider unavailable',
      );
      return;
    }

    this.apiKey = apiKey;
    this.available = true;
    this.logger.log(
      `OpenRouter provider initialized (model: ${this.modelName})`,
    );
  }

  async generateContent(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenRouter client not initialized – missing API key');
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.modelName,
            messages: [
              {
                role: 'system',
                content:
                  'You are CareDesk AI, a healthcare support assistant. Always respond with valid JSON when the prompt asks for JSON.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        });

        const rawBody = await response.text();

        let data: OpenRouterResponse;
        try {
          data = JSON.parse(rawBody) as OpenRouterResponse;
        } catch {
          throw new Error(
            `OpenRouter returned non-JSON body (status=${response.status}): ${rawBody}`,
          );
        }

        if (!response.ok) {
          const errorMessage =
            data.error?.message ??
            `OpenRouter request failed with ${response.status}`;
          throw new Error(`${response.status}: ${errorMessage}`);
        }

        const text = data.choices?.[0]?.message?.content;

        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from OpenRouter');
        }

        return text.trim();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (this.isRateLimitError(message) && attempt < this.maxAttempts) {
          const delayMs = attempt * 1000;
          this.logger.warn(
            `OpenRouter rate-limited – attempt ${attempt}/${this.maxAttempts}, retrying in ${delayMs}ms`,
          );
          await this.sleep(delayMs);
          continue;
        }

        if (this.isRateLimitError(message) && attempt >= this.maxAttempts) {
          const quotaError = new Error(`QUOTA_EXCEEDED: ${message}`);
          (quotaError as Error & { isQuota: boolean }).isQuota = true;
          throw quotaError;
        }

        throw error;
      }
    }

    throw new Error('OpenRouter request failed without explicit error');
  }

  private isRateLimitError(message: string): boolean {
    return (
      message.includes('429') ||
      message.includes('quota') ||
      message.includes('Quota') ||
      message.includes('Too Many Requests') ||
      message.includes('rate limit') ||
      message.includes('Rate limit')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getName(): string {
    return `OpenRouter (${this.modelName})`;
  }

  isAvailable(): boolean {
    return this.available;
  }
}
