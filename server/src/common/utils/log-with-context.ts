import { Logger } from '@nestjs/common';

/**
 * Structured log metadata — consistent across all modules.
 * All fields are optional; include what's available in your context.
 */
export interface LogContext {
  correlationId?: string;
  conversationId?: string;
  messageId?: string;
  userId?: string;
  jobId?: string | number;
  channel?: string;
  duration?: number;
  [key: string]: unknown;
}

/**
 * Format log metadata into a compact, parseable suffix string.
 *
 * Output: `[cid=abc123 conv=xyz msg=456 user=u1]`
 *
 * This keeps logs human-readable while being grep-friendly for production debugging.
 */
function formatContext(ctx: LogContext): string {
  const parts: string[] = [];

  if (ctx.correlationId) parts.push(`cid=${ctx.correlationId.slice(0, 8)}`);
  if (ctx.conversationId) parts.push(`conv=${ctx.conversationId.slice(-6)}`);
  if (ctx.messageId) parts.push(`msg=${ctx.messageId.slice(-6)}`);
  if (ctx.userId) parts.push(`user=${ctx.userId.slice(-6)}`);
  if (ctx.jobId) parts.push(`job=${ctx.jobId}`);
  if (ctx.channel) parts.push(`ch=${ctx.channel}`);
  if (ctx.duration !== undefined) parts.push(`${ctx.duration}ms`);

  // Include any extra keys
  for (const [key, value] of Object.entries(ctx)) {
    if (
      ![
        'correlationId', 'conversationId', 'messageId',
        'userId', 'jobId', 'channel', 'duration',
      ].includes(key) &&
      value !== undefined
    ) {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.length > 0 ? ` [${parts.join(' ')}]` : '';
}

/**
 * Log with structured context. Uses NestJS Logger under the hood.
 *
 * @example
 * logWithContext(this.logger, 'info', 'Message processed', {
 *   correlationId: 'abc-123',
 *   conversationId: '507f1f77',
 *   duration: 342,
 * });
 * // Output: [ConversationsService] Message processed [cid=abc-123 conv=7f1f77 342ms]
 */
export function logWithContext(
  logger: Logger,
  level: 'log' | 'warn' | 'error' | 'debug',
  message: string,
  ctx: LogContext = {},
): void {
  const suffix = formatContext(ctx);
  logger[level](`${message}${suffix}`);
}
