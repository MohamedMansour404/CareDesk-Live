import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { AiProvider } from '../interfaces/ai-provider.interface.js';

/**
 * Google Gemini implementation of AiProvider.
 */
@Injectable()
export class GeminiProvider extends AiProvider implements OnModuleInit {
  private readonly logger = new Logger(GeminiProvider.name);
  private model: GenerativeModel | null = null;
  private modelName: string;
  private available = false;

  constructor(private configService: ConfigService) {
    super();
    this.modelName =
      this.configService.get<string>('gemini.model') ?? 'gemini-2.0-flash';
  }

  onModuleInit() {
    const apiKey = this.configService.get<string>('gemini.apiKey');

    if (!apiKey) {
      this.logger.warn(
        'Gemini API key not configured – provider unavailable',
      );
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: this.modelName });
    this.available = true;
    this.logger.log(`Gemini provider initialized (model: ${this.modelName})`);
  }

  async generateContent(prompt: string): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini model not initialized – missing API key');
    }

    const result = await this.model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from Gemini');
    }

    return text.trim();
  }

  getName(): string {
    return `Gemini (${this.modelName})`;
  }

  isAvailable(): boolean {
    return this.available;
  }
}
