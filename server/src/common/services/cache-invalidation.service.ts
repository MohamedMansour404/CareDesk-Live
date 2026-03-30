import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { CACHE_KEYS } from '../cache/cache-keys.js';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(private readonly cacheService: CacheService) {}

  async invalidateConversation(conversationId: string): Promise<void> {
    await Promise.all([
      this.cacheService.invalidate(CACHE_KEYS.conversation(conversationId)),
      this.cacheService.invalidateNamespace(
        CACHE_KEYS.conversationQueueNamespace,
      ),
      this.cacheService.invalidateNamespace(
        CACHE_KEYS.conversationMessagesNamespace(conversationId),
      ),
      this.cacheService.invalidateNamespace(CACHE_KEYS.analyticsNamespace),
    ]);
  }

  async invalidateConversationList(): Promise<void> {
    await Promise.all([
      this.cacheService.invalidateNamespace(
        CACHE_KEYS.conversationQueueNamespace,
      ),
      this.cacheService.invalidateNamespace(CACHE_KEYS.analyticsNamespace),
    ]);
  }

  async invalidateMessageMutation(conversationId: string): Promise<void> {
    await Promise.all([
      this.cacheService.invalidate(CACHE_KEYS.conversation(conversationId)),
      this.cacheService.invalidateNamespace(
        CACHE_KEYS.conversationQueueNamespace,
      ),
      this.cacheService.invalidateNamespace(
        CACHE_KEYS.conversationMessagesNamespace(conversationId),
      ),
      this.cacheService.invalidateNamespace(CACHE_KEYS.analyticsNamespace),
    ]);
  }

  logSkipped(operation: string, reason: string): void {
    this.logger.debug(`Cache invalidation skipped for ${operation}: ${reason}`);
  }
}
