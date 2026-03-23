import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { AI_PROVIDER } from './interfaces/ai-provider.interface.js';
import { GeminiProvider } from './providers/gemini.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useClass: GeminiProvider,
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
