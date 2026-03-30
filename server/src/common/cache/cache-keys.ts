export const CACHE_KEYS = {
  conversation: (conversationId: string) => `conv:${conversationId}`,
  conversationQueue: (page: number, limit: number) =>
    `conv:queue:${page}:${limit}`,
  conversationQueueNamespace: 'conv:queue',
  conversationMessages: (conversationId: string, page: number, limit: number) =>
    `msg:conv:${conversationId}:${page}:${limit}`,
  conversationMessagesNamespace: (conversationId: string) =>
    `msg:conv:${conversationId}`,
  analyticsOverview: 'analytics:overview',
  analyticsAgent: (agentId: string) => `analytics:agent:${agentId}`,
  analyticsNamespace: 'analytics',
} as const;

export const CACHE_TTLS = {
  conversation: 30,
  conversationQueue: 10,
  conversationMessages: 10,
  analytics: 60,
} as const;
