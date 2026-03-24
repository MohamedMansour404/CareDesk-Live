import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service.js';
import { AI_PROVIDER } from './interfaces/ai-provider.interface.js';
import { GeminiProvider } from './providers/gemini.provider.js';
import { OpenAiProvider } from './providers/openai.provider.js';

/**
 * AI Module — supports multiple AI providers.
 * 
 * Set AI_PROVIDER=openai or AI_PROVIDER=gemini in .env to choose.
 * Default: openai (more reliable for free tier usage).
 */
@Global()
@Module({
  providers: [
    GeminiProvider,
    OpenAiProvider,
    {
      provide: AI_PROVIDER,
      useFactory: (
        configService: ConfigService,
        geminiProvider: GeminiProvider,
        openAiProvider: OpenAiProvider,
      ) => {
        const providerName = configService.get<string>('AI_PROVIDER') ?? 'openai';

        if (providerName === 'gemini' && geminiProvider.isAvailable()) {
          return geminiProvider;
        }

        if (openAiProvider.isAvailable()) {
          return openAiProvider;
        }

        // Fallback to whatever is available
        if (geminiProvider.isAvailable()) {
          return geminiProvider;
        }

        // Return OpenAI provider even if unavailable — it will throw a clear error
        return openAiProvider;
      },
      inject: [ConfigService, GeminiProvider, OpenAiProvider],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
