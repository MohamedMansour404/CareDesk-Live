import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service.js';
import {
  AI_PROVIDER,
  AI_PROVIDERS,
} from './interfaces/ai-provider.interface.js';
import { GeminiProvider } from './providers/gemini.provider.js';
import { OpenAiProvider } from './providers/openai.provider.js';
import { OpenRouterProvider } from './providers/openrouter.provider.js';

/**
 * AI Module — supports multiple AI providers.
 *
 * Provider priority order:
 * 1) OpenRouter (primary)
 * 2) Gemini (fallback)
 * 3) OpenAI (fallback)
 */
@Global()
@Module({
  providers: [
    OpenRouterProvider,
    GeminiProvider,
    OpenAiProvider,
    {
      provide: AI_PROVIDERS,
      useFactory: (
        openRouterProvider: OpenRouterProvider,
        geminiProvider: GeminiProvider,
        openAiProvider: OpenAiProvider,
      ) => {
        return [openRouterProvider, geminiProvider, openAiProvider];
      },
      inject: [OpenRouterProvider, GeminiProvider, OpenAiProvider],
    },
    {
      provide: AI_PROVIDER,
      useFactory: (openRouterProvider: OpenRouterProvider) => {
        return openRouterProvider;
      },
      inject: [OpenRouterProvider],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
